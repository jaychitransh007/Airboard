/**
 * A short looping demo of the core idea: type a sentence to Airo and the
 * diagram builds itself. Plain HTML, SVG and CSS animation, so it costs the
 * landing page no JavaScript. With reduced motion it shows the finished board.
 */
export function IdeaDemo() {
  return (
    <figure className="idea-demo" aria-labelledby="idea-demo-caption">
      <div className="idea-demo-board" aria-hidden="true">
        <svg className="idea-demo-diagram" viewBox="0 0 600 240" role="presentation">
          <defs>
            <marker id="idea-demo-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" />
            </marker>
          </defs>
          <line className="idea-demo-link idea-demo-link-1" x1="172" y1="120" x2="228" y2="120" markerEnd="url(#idea-demo-arrow)" />
          <line className="idea-demo-link idea-demo-link-2" x1="372" y1="120" x2="428" y2="120" markerEnd="url(#idea-demo-arrow)" />
          <g className="idea-demo-node idea-demo-node-1">
            <rect x="40" y="85" width="130" height="70" rx="16" />
            <text x="105" y="126">User</text>
          </g>
          <g className="idea-demo-node idea-demo-node-2">
            <rect x="235" y="85" width="135" height="70" rx="16" />
            <text x="302.5" y="126">Orders API</text>
          </g>
          <g className="idea-demo-node idea-demo-node-3">
            <rect x="435" y="80" width="125" height="80" rx="40" />
            <text x="497.5" y="126">Database</text>
          </g>
        </svg>
        <div className="idea-demo-applied">✓ Added 3 shapes and 2 connections <span>Undo</span></div>
        <div className="idea-demo-command">
          <span className="idea-demo-airo">✦ Airo</span>
          <span className="idea-demo-typed">Add a user, an orders API and a database, then connect them</span>
        </div>
      </div>
      <figcaption id="idea-demo-caption">
        Type or say what you mean. Airboard adds the shapes, names them and connects them, and
        Undo is one step away.
      </figcaption>
    </figure>
  );
}
