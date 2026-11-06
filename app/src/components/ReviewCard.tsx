import { useState } from 'react';
import type { CodeReview } from '../core/reviews';
import { Badge, Button, Card, Row } from './ui';

interface Props {
  review: CodeReview;
  onDecision(id: string, decision: 'approve' | 'request-changes' | 'reject' | 'open-diff', comment: string): void;
}

/** Code-review card (brief 3C.4). All agent text inert. Request-changes
 *  sends the user's comment back to the agent verbatim (plain text). */
export function ReviewCard({ review, onDecision }: Props) {
  const [comment, setComment] = useState('');
  const totalAdd = review.files.reduce((n, f) => n + f.additions, 0);
  const totalDel = review.files.reduce((n, f) => n + f.deletions, 0);
  return (
    <Card title={review.title}>
      <Row label="Changes">{review.files.length} files · +{totalAdd} / -{totalDel}</Row>
      <Row label="Tests"><Badge tone={review.testsStatus === 'passed' ? 'action' : review.testsStatus === 'failed' ? 'danger' : 'neutral'}>{review.testsStatus}</Badge></Row>
      {review.files.map((f) => (
        <Row key={f.path} label={f.path}>+{f.additions} / -{f.deletions}</Row>
      ))}
      {review.summary ? <p className="expanded-sub">{review.summary}</p> : null}
      <label>
        <span className="row-label">Comment for the agent</span>
        <textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="What should change?" />
      </label>
      <div className="state-grid">
        <Button onClick={() => onDecision(review.id, 'open-diff', '')}>Open diff</Button>
        <Button variant="primary" onClick={() => onDecision(review.id, 'approve', '')}>Approve</Button>
        <Button onClick={() => onDecision(review.id, 'request-changes', comment)}>Request changes</Button>
        <Button variant="danger" onClick={() => onDecision(review.id, 'reject', '')}>Reject</Button>
      </div>
    </Card>
  );
}
