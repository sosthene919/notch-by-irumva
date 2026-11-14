import { useState } from 'react';
import { Badge, Button, Card, Row } from '../components/ui';
import { BatteryPill, SegmentedLevel } from '../components/hud';

/** Living style guide (brief section 4): every component, every state. Route: #/styleguide */
export function StyleGuide() {
  const [hudLevel, setHudLevel] = useState(0.43);
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
      <Card title="HUD — volume segments (1.1.5)">
        <SegmentedLevel level={hudLevel} onSet={setHudLevel} />
        <Row label="Level">{Math.round(hudLevel * 100)}%</Row>
      </Card>
      <Card title="HUD — battery pill (1.1.5)">
        <Row label="Battery (43%, charging)">
          <BatteryPill status={{ charging: true, batteryPercent: 43, alert: false }} />
        </Row>
      </Card>
      <Card title="About">
        <Row label="Product">Notch by IRUMVA</Row>
        <Row label="Credits">Created by IRUMVA Sosthene. Built with Muse AI and Claude Sonnet.</Row>
      </Card>
    </main>
  );
}
