import Image from "next/image";
import Link from "next/link";
import { PublicShell } from "./PublicShell";

const ideaJourney = [
  {
    number: "01",
    verb: "Catch it",
    title: "Think without stopping to operate software.",
    body: "Speak, sketch, point, or move your hands. Airo keeps the interface out of the way while the thought is still forming.",
    note: "Voice · Ink · Gesture",
  },
  {
    number: "02",
    verb: "Give it shape",
    title: "Turn fragments into a structure people can follow.",
    body: "Create nodes, connect relationships, rearrange the story, and add just enough context to make the invisible obvious.",
    note: "Nodes · Flows · Systems",
  },
  {
    number: "03",
    verb: "Share the thought",
    title: "Keep the explanation inside the conversation.",
    body: "Place the visual over your camera or screen, or keep building on Airboard. Your controls stay private; the idea is what travels.",
    note: "Meet · Overlay · Canvas",
  },
];

const surfaces = [
  {
    className: "meeting",
    eyebrow: "In the meeting · private preview",
    title: "Your explanation lives on your video.",
    body: "Airboard composites neon diagrams with your camera, so people see you and the idea together—not a second canvas and not your controls.",
    link: "/integrations/google-meet",
    linkLabel: "See the Google Meet integration",
    tags: ["Audience-safe", "Private controls"],
  },
  {
    className: "overlay",
    eyebrow: "Over your screen · development preview",
    title: "Draw on the thing you are already showing.",
    body: "Use the native click-through overlay to annotate slides, prototypes, dashboards, or any desktop app without moving the audience elsewhere.",
    link: "/download",
    linkLabel: "Explore the desktop overlay",
    tags: ["Click-through", "Screen-aware"],
  },
  {
    className: "canvas",
    eyebrow: "On Airboard",
    title: "Give big ideas room to become systems.",
    body: "Open a persistent, limitless workspace for solo thinking, teaching, workshops, and the diagrams you want to return to later.",
    link: "/product",
    linkLabel: "Explore the Airboard workspace",
    tags: ["Infinite canvas", "Save & export"],
  },
];

export function LandingPage() {
  return (
    <PublicShell>
      <section className="landing-hero landing-hero-concept">
        <Image
          className="landing-hero-art"
          src="/landing/airboard-ideas-in-motion.webp"
          alt="An idea flowing from conversation and hand gestures into a diagram shared in a video meeting."
          fill
          priority
          sizes="(max-width: 720px) 100vw, 1320px"
        />
        <div className="landing-hero-wash" aria-hidden="true" />
        <div className="landing-copy">
          <p className="eyebrow">Controlled pilot · ideas, still in motion</p>
          <h1>
            Let the idea flow.
            <br />
            <em>Make it visible.</em>
          </h1>
          <p>
            Speak it, sketch it, point at it, or move it with your hands. Airboard turns live
            thinking into a shared visual layer—on its own canvas, over your screen, or directly
            in your meeting video.
          </p>
          <div className="hero-actions">
            <Link className="button button-primary button-large" href="/signup">
              Join the standalone pilot
            </Link>
            <Link className="button button-quiet button-large" href="/demo">
              See an idea move
            </Link>
          </div>
          <small>Standalone web pilot · 3-day trial · No card required · Integrations remain previews</small>
        </div>
        <p className="hero-idea-caption">
          <span aria-hidden="true">✦</span>
          Thought → shape → shared understanding
        </p>
      </section>

      <section className="idea-journey" aria-labelledby="idea-journey-title">
        <div className="section-intro">
          <p className="eyebrow">From impulse to understanding</p>
          <h2 id="idea-journey-title">Stay with the thought. Airboard keeps up.</h2>
          <p>
            Most ideas arrive before the diagram does. Airboard closes that gap, so the act of
            explaining and the act of visualizing become one continuous motion.
          </p>
        </div>
        <ol className="idea-path">
          {ideaJourney.map((step) => (
            <li key={step.number}>
              <div className="idea-step-marker">
                <span>{step.number}</span>
                <i aria-hidden="true" />
              </div>
              <p>{step.verb}</p>
              <h3>{step.title}</h3>
              <div>{step.body}</div>
              <small>{step.note}</small>
            </li>
          ))}
        </ol>
      </section>

      <section className="surface-section" aria-labelledby="surface-title">
        <div className="surface-heading">
          <div>
            <p className="eyebrow">One idea, wherever you work</p>
            <h2 id="surface-title">No handoff. No second screen. No broken flow.</h2>
          </div>
          <p>
            Airboard meets the idea where it happens, then keeps the visual language consistent as
            you move from private thought to live explanation.
          </p>
        </div>
        <div className="surface-grid">
          {surfaces.map((surface, index) => (
            <article className={`surface-card ${surface.className}`} key={surface.className}>
              <div className="surface-visual" aria-hidden="true">
                <span className="surface-orbit" />
                <span className="surface-node surface-node-a" />
                <span className="surface-node surface-node-b" />
                <i />
              </div>
              <p className="surface-kicker">
                <span>0{index + 1}</span> {surface.eyebrow}
              </p>
              <h3>{surface.title}</h3>
              <p>{surface.body}</p>
              <div className="surface-tags">
                {surface.tags.map((tag) => <span key={tag}>{tag}</span>)}
              </div>
              <Link href={surface.link}>{surface.linkLabel} →</Link>
            </article>
          ))}
        </div>
      </section>

      <section className="proof-strip" aria-label="Airboard use cases">
        <strong>Ideas take many forms</strong>
        <span>System design</span>
        <span>Teaching</span>
        <span>Consulting</span>
        <span>Sales demos</span>
        <span>Workshops</span>
      </section>

      <section className="cta-panel landing-cta">
        <div>
          <p className="eyebrow">Give the next idea somewhere to go</p>
          <h2>When words are not enough, reach for the air.</h2>
        </div>
        <div>
          <p>
            Start with a blank Airboard. Voice and gesture inputs are available in supported
            desktop browsers; meeting and native desktop surfaces require preview access.
          </p>
          <Link className="button button-primary button-large" href="/signup">
            Join the pilot
          </Link>
        </div>
      </section>
    </PublicShell>
  );
}
