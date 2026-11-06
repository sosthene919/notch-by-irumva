import * as vscode from 'vscode';
import { NotchPipeClient, type Pairing } from './pipeClient';

/**
 * Notch Bridge — streams workspace signals to Notch by IRUMVA over the
 * authenticated named pipe (pair once with a code from the island).
 * Works in VS Code and in Antigravity IDE (a VS Code fork); sideload the
 * .vsix there. Notch works without this extension; this only adds data.
 */

let client: NotchPipeClient;
let output: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel('Notch Bridge');
  context.subscriptions.push(output);

  const getPairing = async (): Promise<Pairing | null> => {
    const clientId = context.globalState.get<string>('notchBridge.clientId');
    const secret = await context.secrets.get('notchBridge.secret');
    return clientId && secret ? { clientId, secret } : null;
  };
  client = new NotchPipeClient(getPairing);

  context.subscriptions.push(
    vscode.commands.registerCommand('notchBridge.pair', async () => {
      const code = await vscode.window.showInputBox({
        prompt: 'Enter the pairing code shown in Notch (Developer Hub > Security)',
        placeHolder: '8-character code', ignoreFocusOut: true,
      });
      if (!code) return;
      try {
        const pairing = await client.pair(code.trim().toUpperCase());
        await context.globalState.update('notchBridge.clientId', pairing.clientId);
        await context.secrets.store('notchBridge.secret', pairing.secret);
        void vscode.window.showInformationMessage('Notch Bridge paired. Workspace status will appear in Notch.');
        await publishDiagnostics();
      } catch (e) {
        void vscode.window.showErrorMessage(`Notch Bridge: ${e instanceof Error ? e.message : String(e)}`);
      }
    }),
    vscode.commands.registerCommand('notchBridge.publishStatus', async () => {
      await publishDiagnostics();
      await publishGit();
    }),
    vscode.commands.registerCommand('notchBridge.requestApproval', async () => {
      const action = await vscode.window.showInputBox({ prompt: 'Exact action to request approval for (test)', ignoreFocusOut: true });
      if (!action) return;
      try {
        const decision = await client.requestApproval({
          agent: 'Notch Bridge (VS Code)', action,
          cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
          timeoutMs: 120_000,
        });
        void vscode.window.showInformationMessage(`Notch decision: ${decision}`);
      } catch (e) {
        void vscode.window.showErrorMessage(`Notch Bridge: ${e instanceof Error ? e.message : String(e)}`);
      }
    }),
    vscode.commands.registerCommand('notchBridge.proposeReview', proposeReview),
  );

  // Diagnostics (errors/warnings), debounced.
  let timer: NodeJS.Timeout | undefined;
  const scheduleDiagnostics = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { void publishDiagnostics(); }, 800);
  };
  context.subscriptions.push(vscode.languages.onDidChangeDiagnostics(scheduleDiagnostics));

  // Tasks / build status.
  context.subscriptions.push(
    vscode.tasks.onDidStartTask((e) => {
      void publish({ id: 'bridge-task', kind: 'task', title: `Task running: ${e.execution.task.name}`, priority: 55 });
    }),
    vscode.tasks.onDidEndTaskProcess((e) => {
      const failed = (e.exitCode ?? 0) !== 0;
      void publish({
        id: 'bridge-task', kind: failed ? 'task-failed' : 'task-done',
        title: failed ? `Task failed: ${e.execution.task.name} (exit ${e.exitCode})` : `Task finished: ${e.execution.task.name}`,
        priority: failed ? 80 : 45, expiresInSeconds: 30,
      });
    }),
  );

  // Debug sessions.
  context.subscriptions.push(
    vscode.debug.onDidStartDebugSession((s) => {
      void publish({ id: 'bridge-debug', kind: 'debug', title: `Debugging: ${s.name}`, priority: 50 });
    }),
    vscode.debug.onDidTerminateDebugSession(() => {
      void publish({ id: 'bridge-debug', kind: 'debug', title: 'Debug session ended', priority: 30, expiresInSeconds: 10 });
    }),
  );

  // Terminal shell execution (feature-detected: newer VS Code API).
  const win = vscode.window as unknown as {
    onDidStartTerminalShellExecution?: (cb: (e: { execution: { commandLine: { value: string } } }) => void) => vscode.Disposable;
  };
  if (typeof win.onDidStartTerminalShellExecution === 'function') {
    try {
      context.subscriptions.push(win.onDidStartTerminalShellExecution((e) => {
        void publish({ id: 'bridge-terminal', kind: 'terminal', title: 'Terminal command', subtitle: e.execution.commandLine.value.slice(0, 120), priority: 40, expiresInSeconds: 20 });
      }));
    } catch { /* API not present in this fork/version */ }
  }

  // Git changes.
  void watchGit(context);
  void publishDiagnostics();
}

export function deactivate(): void {}

async function publish(payload: { id: string; kind: string; title: string; subtitle?: string; priority?: number; expiresInSeconds?: number }): Promise<void> {
  try { await client.publishActivity(payload); }
  catch (e) { output.appendLine(`publish skipped: ${e instanceof Error ? e.message : String(e)}`); }
}

async function publishDiagnostics(): Promise<void> {
  let errors = 0; let warnings = 0;
  for (const [, diags] of vscode.languages.getDiagnostics()) {
    for (const d of diags) {
      if (d.severity === vscode.DiagnosticSeverity.Error) errors++;
      else if (d.severity === vscode.DiagnosticSeverity.Warning) warnings++;
    }
  }
  if (errors + warnings === 0) return;
  await publish({
    id: 'bridge-diagnostics', kind: 'diagnostics',
    title: errors > 0 ? `${errors} errors` : `${warnings} warnings`,
    subtitle: errors > 0 && warnings > 0 ? `${warnings} warnings` : vscode.workspace.name ?? '',
    priority: errors > 0 ? 70 : 40,
  });
}

interface GitRepository {
  state: { workingTreeChanges: { uri: vscode.Uri }[]; onDidChange: (cb: () => void) => vscode.Disposable };
  diffWithHEAD(): Promise<string>;
}

async function getGitRepo(): Promise<GitRepository | null> {
  const ext = vscode.extensions.getExtension<{ getAPI(v: number): { repositories: GitRepository[] } }>('vscode.git');
  if (!ext) return null;
  const api = (await ext.activate()).getAPI(1);
  return api.repositories[0] ?? null;
}

async function watchGit(context: vscode.ExtensionContext): Promise<void> {
  const repo = await getGitRepo();
  if (!repo) return;
  context.subscriptions.push(repo.state.onDidChange(() => { void publishGit(repo); }));
  await publishGit(repo);
}

async function publishGit(repo?: GitRepository): Promise<void> {
  const r = repo ?? (await getGitRepo());
  if (!r) return;
  const count = r.state.workingTreeChanges.length;
  if (count === 0) return;
  await publish({ id: 'bridge-git', kind: 'git', title: `${count} changed files`, subtitle: vscode.workspace.name ?? '', priority: 35 });
}

async function proposeReview(): Promise<void> {
  const repo = await getGitRepo();
  if (!repo) { void vscode.window.showErrorMessage('Notch Bridge: Git repository not available.'); return; }
  try {
    const diff = await repo.diffWithHEAD();
    const files = parseDiffStats(diff);
    if (files.length === 0) { void vscode.window.showInformationMessage('Notch Bridge: no changes to review.'); return; }
    const result = await client.proposeReview({
      id: `review-${Date.now()}`, source: 'bridge',
      title: `Changes in ${vscode.workspace.name ?? 'workspace'}`,
      summary: `${files.length} files changed`,
      files, testsStatus: 'not-run', timeoutMs: 180_000,
    });
    if (result.decision === 'open-diff') {
      output.appendLine(diff);
      output.show(true);
      for (const f of files.slice(0, 5)) {
        const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0]!.uri, f.path);
        await vscode.window.showTextDocument(uri, { preview: true });
      }
      void vscode.window.showInformationMessage('Notch asked to open the diff: files opened, full diff in the Notch Bridge output.');
    } else if (result.decision === 'request-changes') {
      void vscode.window.showWarningMessage(`Notch requested changes${result.comment ? `: ${result.comment}` : ''}`);
    } else {
      void vscode.window.showInformationMessage(`Notch review decision: ${result.decision}`);
    }
  } catch (e) {
    void vscode.window.showErrorMessage(`Notch Bridge: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Parse unified diff text into per-file +/- counts. */
export function parseDiffStats(diff: string): { path: string; additions: number; deletions: number }[] {
  const files: { path: string; additions: number; deletions: number }[] = [];
  let current: { path: string; additions: number; deletions: number } | null = null;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const m = line.match(/ b\/(.+)$/);
      current = { path: m ? m[1] : 'unknown', additions: 0, deletions: 0 };
      files.push(current);
    } else if (current && line.startsWith('+') && !line.startsWith('+++')) current.additions++;
    else if (current && line.startsWith('-') && !line.startsWith('---')) current.deletions++;
  }
  return files;
}
