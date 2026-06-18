import { ModalShell } from './ModalShell';
import { DialogActions } from './DialogActions';
import packageJson from '../../package.json';

interface AboutDialogProps {
  open: boolean;
  onClose: () => void;
}

const bundledFonts = [
  { name: 'Scie Sans', use: 'App UI and Scienfy Inc./Amin style typography', license: 'SIL OFL 1.1' },
  { name: 'Scie Sans Compact', use: 'Compact scientific prose and dense document tables', license: 'SIL OFL 1.1' },
  { name: 'Source Serif 4', use: 'Manuscript, journal, and Nature-style prose', license: 'SIL OFL 1.1' },
  { name: 'Lora', use: 'Science-style long-form reading surface', license: 'SIL OFL 1.1' },
  { name: 'IBM Plex Sans', use: 'Lab-note, technical, and label typography', license: 'SIL OFL 1.1' },
  { name: 'JetBrains Mono', use: 'Source mode, code blocks, and SVG source labels', license: 'SIL OFL 1.1' },
  { name: 'KaTeX math fonts', use: 'Equation rendering', license: 'KaTeX package MIT license' },
];

const GITHUB_URL = 'https://github.com/scienfy/scie-md';
const BUG_REPORT_URL = `${GITHUB_URL}/issues/new`;

export function AboutDialog({ open, onClose }: AboutDialogProps) {
  return (
    <ModalShell open={open} titleId="about-title" className="about-dialog" onCancel={onClose}>
        <div className="about-brand">
          <img className="about-brand-mark" src="/icons/sciemd-icon.svg" alt="" aria-hidden="true" />
          <div>
            <h2 id="about-title">About ScieMD</h2>
            <p>Scientific Markdown writing, visual editing, and LLM-safe revision by Scienfy Inc.</p>
          </div>
        </div>
        <dl className="about-facts">
          <div>
            <dt>Version</dt>
            <dd>{packageJson.version}</dd>
          </div>
          <div>
            <dt>Privacy</dt>
            <dd>No telemetry. Your documents stay local unless you choose to share or export them.</dd>
          </div>
          <div>
            <dt>File model</dt>
            <dd>Saved documents remain readable Markdown with explicit ScieMD comments for review metadata.</dd>
          </div>
        </dl>
        <div className="about-links" aria-label="Project links">
          <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
          <a href={BUG_REPORT_URL} target="_blank" rel="noreferrer">Report bug</a>
        </div>
        <section className="about-credits" aria-labelledby="about-fonts-title">
          <h3 id="about-fonts-title">Fonts &amp; Credits</h3>
          <p>ScieMD bundles redistributable fonts so document styles do not depend on proprietary system fonts.</p>
          <dl>
            {bundledFonts.map((font) => (
              <div key={font.name}>
                <dt>{font.name}</dt>
                <dd>
                  <span>{font.use}</span>
                  <small>{font.license}</small>
                </dd>
              </div>
            ))}
          </dl>
          <p className="about-license-note">License texts are included in `public/fonts/` and summarized in `THIRD_PARTY_LICENSES.md`.</p>
        </section>
        <DialogActions>
          <button type="button" className="primary" onClick={onClose}>Done</button>
        </DialogActions>
    </ModalShell>
  );
}
