import { Link, Outlet, useLocation } from 'react-router-dom';
import { ThemeToggle } from './ThemeToggle';
import './PublicSite.css';

const capabilities = [
  {
    number: '01',
    title: 'Monitor drift',
    description: 'Review observed drift scores and configured thresholds to identify changes that may need investigation.',
    label: 'Monitoring',
  },
  {
    number: '02',
    title: 'Investigate predictions',
    description: 'Explore recorded predictions, model versions, confidence, latency, and request context.',
    label: 'Inference',
  },
  {
    number: '03',
    title: 'Manage retraining',
    description: 'Follow retraining jobs and their persisted lifecycle, including data-sufficiency blockers.',
    label: 'Lifecycle',
  },
  {
    number: '04',
    title: 'Evaluate candidates',
    description: 'Compare candidate and incumbent evaluation evidence before making a promotion decision.',
    label: 'Evaluation',
  },
  {
    number: '05',
    title: 'Verify deployments',
    description: 'A future workflow is planned to verify a staging model and artifact independently before reporting activation.',
    label: 'Planned',
  },
];

const workflow = [
  ['Observe', 'Review model activity and drift signals from available monitoring data.'],
  ['Investigate', 'Inspect prediction history and determine whether a signal needs follow-up.'],
  ['Evaluate', 'Require adequate verified data and compare candidate results with the incumbent.'],
  ['Verify', 'Treat deployment as complete only after an independent live-version and artifact check.'],
];

export function PublicLayout() {
  const location = useLocation();
  const isHome = location.pathname === '/';

  return (
    <div className="public-site">
      <a className="public-skip-link" href="#public-main">Skip to content</a>
      <header className="public-header">
        <div className="public-header-inner">
          <Link className="public-brand" to="/" aria-label="ML-Drift-Lens home">
            <span className="public-brand-mark" aria-hidden="true">ML</span>
            <span>ML-Drift-Lens</span>
          </Link>
          <nav className="public-nav" aria-label="Public navigation">
            <a href={isHome ? '#capabilities' : '/#capabilities'}>Capabilities</a>
            <a href={isHome ? '#workflow' : '/#workflow'}>Workflow</a>
            <Link to="/app/overview">Existing dashboard</Link>
          </nav>
          <div className="public-header-actions">
            <ThemeToggle />
            <Link className="public-auth-button public-auth-placeholder" to="/login">Sign in</Link>
            <Link className="public-auth-button public-auth-button-primary public-auth-placeholder" to="/register">Create account</Link>
          </div>
        </div>
      </header>
      <Outlet />
      <footer className="public-footer">
        <div className="public-footer-inner">
          <div className="public-footer-top">
            <div className="public-footer-brand-wrap">
              <Link className="public-footer-brand" to="/">
                <span className="public-brand-mark" aria-hidden="true">ML</span>
                <span>ML-Drift-Lens</span>
              </Link>
              <p className="public-footer-tagline">
                Model monitoring and lifecycle visibility, with clear boundaries around what is configured and verified.
              </p>
            </div>
            <nav className="public-footer-nav" aria-label="Footer navigation">
              <a href={isHome ? '#capabilities' : '/#capabilities'}>Capabilities</a>
              <a href={isHome ? '#workflow' : '/#workflow'}>Workflow</a>
              <Link to="/app/overview">Existing dashboard</Link>
            </nav>
          </div>
          <div className="public-footer-bottom">
            <span className="public-footer-note">
              Account sign-in and registration are available; deployment verification is planned.
            </span>
            <span className="public-footer-copy">
              © {new Date().getFullYear()} ML-Drift-Lens
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}

function ProductPreview() {
  return (
    <div className="preview-frame" aria-label="Illustrative, non-live product preview">
      <div className="preview-topbar">
        <div className="preview-brand"><span aria-hidden="true" /> Monitoring overview</div>
        <span className="preview-label">Illustrative preview · no live data</span>
      </div>
      <div className="preview-body">
        <aside className="preview-sidebar" aria-hidden="true">
          <i /><i /><i /><i />
        </aside>
        <div className="preview-content">
          <div className="preview-heading">
            <span className="preview-skeleton preview-title" />
            <span className="preview-skeleton preview-control" />
          </div>
          <div className="preview-metrics" aria-hidden="true">
            <div><span /><strong /></div>
            <div><span /><strong /></div>
            <div><span /><strong /></div>
          </div>
          <div className="preview-panels">
            <div className="preview-chart">
              <span className="preview-panel-heading">Drift signal · illustrative</span>
              <svg viewBox="0 0 560 150" role="img" aria-label="Decorative example line shapes, not model measurements">
                <path className="preview-gridline" d="M0 35H560 M0 75H560 M0 115H560" />
                <path className="preview-line-one" d="M0 107 C65 95 75 66 140 78 S220 109 280 81 S365 52 420 68 S510 94 560 41" />
                <path className="preview-line-two" d="M0 88 H560" />
              </svg>
              <div className="preview-legend"><span>Observed signal (illustrative)</span><span>Reference threshold (illustrative)</span></div>
            </div>
            <div className="preview-events">
              <span className="preview-panel-heading">Lifecycle visibility</span>
              <div><i /> Job state is reported from persisted records</div>
              <div><i /> Candidate readiness is not deployment</div>
              <div><i /> Unconfigured integrations remain unavailable</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function LandingPage() {
  return (
    <main className="public-main" id="public-main">
      <section className="public-hero" aria-labelledby="hero-title">
        <div className="public-hero-inner">
          <div className="public-hero-copy">
            <p className="public-eyebrow"><span /> Machine-learning operations</p>
            <h1 id="hero-title">See model change clearly.<br /><span>Act with evidence.</span></h1>
            <p className="public-hero-description">
              ML-Drift-Lens brings model monitoring and lifecycle signals into one place—so teams can inspect what is observed, understand what is missing, and make decisions with context.
            </p>
            <div className="public-hero-actions">
              <Link className="public-button public-button-primary" to="/register">Registration status</Link>
              <Link className="public-button public-button-secondary" to="/app/overview">Explore the existing dashboard</Link>
            </div>
            <p className="public-auth-note">Account access is not available yet. No sign-in or registration provider is configured.</p>
          </div>
          <div className="public-hero-preview"><ProductPreview /></div>
        </div>
      </section>

      <section className="public-section public-capabilities" id="capabilities" aria-labelledby="capabilities-title">
        <div className="public-section-heading">
          <p className="public-eyebrow">A connected workflow</p>
          <h2 id="capabilities-title">The context around every model decision</h2>
          <p>Explore the capabilities the platform is designed to bring together. Current availability varies by API and external configuration.</p>
        </div>
        <div className="capability-grid">
          {capabilities.map((capability) => (
            <article className={`capability-card${capability.label === 'Planned' ? ' capability-planned' : ''}`} key={capability.number}>
              <div className="capability-card-top"><span>{capability.number}</span><span className="capability-label">{capability.label}</span></div>
              <h3>{capability.title}</h3>
              <p>{capability.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="public-section workflow-section" id="workflow" aria-labelledby="workflow-title">
        <div className="workflow-intro">
          <p className="public-eyebrow">From signal to decision</p>
          <h2 id="workflow-title">A lifecycle built around evidence</h2>
          <p>Each stage should make its data source and readiness visible. A candidate is not a deployment, and an unverified label is not ground truth.</p>
        </div>
        <ol className="workflow-list">
          {workflow.map(([title, description], index) => (
            <li key={title}>
              <span className="workflow-step">{String(index + 1).padStart(2, '0')}</span>
              <div><h3>{title}</h3><p>{description}</p></div>
            </li>
          ))}
        </ol>
      </section>

      <section className="public-closing" aria-labelledby="closing-title">
        <div>
          <p className="public-eyebrow">Start with what is available</p>
          <h2 id="closing-title">Explore the current monitoring experience.</h2>
          <p>The existing dashboard shows data returned by the configured backend. It does not imply that authentication or staging deployment verification is ready.</p>
        </div>
        <Link className="public-button public-button-primary" to="/app/overview">Open the existing dashboard</Link>
      </section>
    </main>
  );
}
