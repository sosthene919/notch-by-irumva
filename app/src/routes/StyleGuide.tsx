import { useState } from 'react';
import { Badge, Button, Card, Row, Slider, Toggle } from '../components/ui';

/** Living style guide (brief section 4): every component, every state. Route: #/styleguide */
export function StyleGuide() {
  const [on, setOn] = useState(true);
  const [level, setLevel] = useState(50);
  return (
    <main className="styleguide">
      <h1>Notch style guide</h1>
      <Card title="Button — states">
        <div className="state-grid">
          <Button variant="primary">Primary</Button>
          <Button>Ghost</Button>
          <Button variant="danger">Deny</Button>
          <Button disabled>Disabled</Button>
          <Button loading>Loading</Button>
        </div>
      </Card>
      <Card title="Badge — tones (never color alone: text label always present)">
        <div className="state-grid">
          <Badge>Neutral</Badge><Badge tone="action">Action</Badge>
          <Badge tone="agent">Agent</Badge><Badge tone="danger">Recording</Badge>
        </div>
      </Card>
      <Card title="Row, Toggle, Slider">
        <Row label="Provider">Enabled</Row>
        <Toggle label="Launch at startup" checked={on} onChange={(e) => setOn(e.target.checked)} />
        <Slider label="Volume" min={0} max={100} value={level} onChange={(e) => setLevel(Number(e.target.value))} />
      </Card>
      <Card title="About">
        <Row label="Product">Notch by IRUMVA</Row>
        <Row label="Credits">Created by IRUMVA Sosthene. Built with Muse AI and Claude Sonnet.</Row>
      </Card>
    </main>
  );
}
