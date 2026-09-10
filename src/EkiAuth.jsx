import React, { useState } from "react";
import { Eye, EyeOff, ArrowRight, ArrowLeft, Loader2, ShieldCheck } from "lucide-react";

/* ==================================================================== *
 * EKI² — dedicated institutional authentication environment
 * -------------------------------------------------------------------- *
 * Reached only from the audience chooser: "Continue as University".
 * This is a VISUAL environment change — the auth backend is unchanged
 * (App.jsx `handleUniversitySignIn`: signInWithPassword ->
 * get_my_institutions -> /institutional, with independent EKI²
 * re-authorisation on load). Nothing here weakens that gate.
 *
 * Design language deliberately diverges from the student JOB.READY
 * world and previews the institutional app: deep navy ground, a faint
 * intelligence/grid motif, restrained blue accent, glass auth surface,
 * Inter, generous spacing. Recognisably a JOB.READY product ("A
 * JOB.READY product" is stated), but a distinct premium layer.
 *
 * Pure presentation. All state + handlers come from App via props.
 * Lightweight: one scoped <style> block, CSS-only motion, no libraries,
 * no image assets. Honours prefers-reduced-motion.
 * ==================================================================== */

const SIGNALS = [
  { label: "Readiness", value: "72%" },
  { label: "Trajectory", value: "↑ 14 pts" },
  { label: "Intervention", value: "12 students" },
];

function GridMotif() {
  // Faint grid + a few "intelligence" nodes. Decorative only.
  return (
    <svg className="eki-motif" viewBox="0 0 800 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <pattern id="eki-grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M40 0H0V40" fill="none" stroke="rgba(148,178,255,0.10)" strokeWidth="1" />
        </pattern>
        <radialGradient id="eki-glow" cx="50%" cy="42%" r="55%">
          <stop offset="0%" stopColor="rgba(59,130,246,0.30)" />
          <stop offset="55%" stopColor="rgba(59,130,246,0.05)" />
          <stop offset="100%" stopColor="rgba(59,130,246,0)" />
        </radialGradient>
      </defs>
      <rect width="800" height="800" fill="url(#eki-grid)" />
      <rect width="800" height="800" fill="url(#eki-glow)" />
      <g stroke="rgba(148,178,255,0.22)" strokeWidth="1">
        <line x1="120" y1="180" x2="300" y2="300" />
        <line x1="300" y1="300" x2="250" y2="520" />
        <line x1="300" y1="300" x2="540" y2="240" />
        <line x1="540" y1="240" x2="640" y2="430" />
        <line x1="250" y1="520" x2="470" y2="600" />
        <line x1="640" y1="430" x2="470" y2="600" />
      </g>
      {[
        [120, 180], [300, 300], [540, 240], [250, 520], [640, 430], [470, 600],
      ].map(([cx, cy], i) => (
        <circle key={i} className="eki-node" cx={cx} cy={cy} r="3.5"
          fill="#6f9bff" style={{ animationDelay: `${i * 0.7}s` }} />
      ))}
    </svg>
  );
}

function PasswordField({ value, onChange }) {
  const [show, setShow] = useState(false);
  return (
    <div className="eki-input eki-input-pw">
      <input
        id="eki-password"
        type={show ? "text" : "password"}
        autoComplete="current-password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
      />
      <button
        type="button"
        className="eki-pwtoggle"
        aria-pressed={show}
        aria-label={show ? "Hide password" : "Show password"}
        onClick={() => setShow((v) => !v)}
      >
        {show ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
      </button>
    </div>
  );
}

export default function EkiAuth({
  email, onEmailChange, password, onPasswordChange,
  busy, error, noWorkspace, noWorkspaceEmail,
  onSubmit, onForgot, onReturn, onBookDemo, onContinueStudent, onSignOut, onLegal,
}) {
  return (
    <div className="eki-auth">
      <style>{EKI_AUTH_CSS}</style>
      <GridMotif />

      {/* minimal application header — not the JOB.READY site nav */}
      <header className="eki-header">
        <div className="eki-wordmark eki-wordmark-sm">
          EKI<sup>2</sup>
        </div>
        <div className="eki-product-tag">A JOB.READY product</div>
      </header>

      <div className="eki-grid-wrap">
        {/* ---- hero / identity ------------------------------------ */}
        <section className="eki-hero">
          <div className="eki-brand">
            <div className="eki-wordmark eki-wordmark-lg">EKI<sup>2</sup></div>
            <div className="eki-expanded">Employability Knowledge Intelligence Interface</div>
          </div>
          <p className="eki-proposition">
            Institutional intelligence for student employability.
          </p>

          <div className="eki-rule" />

          <div className="eki-signals" role="group" aria-label="Illustrative interface signals">
            {SIGNALS.map((s) => (
              <div className="eki-signal" key={s.label}>
                <div className="eki-signal-label">{s.label}</div>
                <div className="eki-signal-value">{s.value}</div>
              </div>
            ))}
          </div>
          <div className="eki-signal-note">Illustrative interface signals &middot; synthetic data</div>
        </section>

        {/* ---- authentication panel ----------------------------- */}
        <section className="eki-panelwrap">
          <div className="eki-panel">
            {noWorkspace ? (
              <>
                <div className="eki-panel-icon"><ShieldCheck size={20} aria-hidden="true" /></div>
                <h1 className="eki-panel-title">No workspace linked yet</h1>
                <p className="eki-panel-sub">
                  <strong>{noWorkspaceEmail}</strong> is a valid JOB.READY account, but it isn&rsquo;t
                  authorised for an institution&rsquo;s EKI&sup2; workspace. Ask your institution&rsquo;s
                  EKI&sup2; administrator to add you to the Careers team, or arrange a demo.
                </p>
                <div className="eki-actions">
                  <button type="button" className="eki-btn eki-btn-primary" onClick={onBookDemo}>
                    Arrange a demo
                  </button>
                  <button type="button" className="eki-btn eki-btn-ghost" onClick={onContinueStudent}>
                    Continue to JOB.READY
                  </button>
                  <button type="button" className="eki-btn eki-btn-quiet" onClick={onSignOut}>
                    Sign out
                  </button>
                </div>
              </>
            ) : (
              <>
                <h1 className="eki-panel-title">Sign in to EKI&sup2;</h1>
                <p className="eki-panel-sub">Access your institution&rsquo;s employability intelligence workspace.</p>

                {error ? <div className="eki-alert" role="alert">{error}</div> : null}

                <form
                  className="eki-form"
                  onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
                >
                  <label className="eki-label" htmlFor="eki-email">Work email</label>
                  <input
                    id="eki-email"
                    className="eki-input"
                    type="email"
                    autoComplete="email"
                    inputMode="email"
                    placeholder="you@university.ac.uk"
                    value={email}
                    onChange={(e) => onEmailChange(e.target.value)}
                    required
                  />

                  <div className="eki-label-row">
                    <label className="eki-label" htmlFor="eki-password">Password</label>
                    <button type="button" className="eki-link" onClick={onForgot}>Forgot password?</button>
                  </div>
                  <PasswordField value={password} onChange={onPasswordChange} />

                  <button type="submit" className="eki-btn eki-btn-primary eki-submit" disabled={busy}>
                    {busy
                      ? <><Loader2 size={16} className="eki-spin" aria-hidden="true" /> Signing in&hellip;</>
                      : <>Sign in to EKI&sup2; <ArrowRight size={16} aria-hidden="true" /></>}
                  </button>
                </form>
              </>
            )}

            <div className="eki-panel-foot">
              <button type="button" className="eki-return" onClick={onReturn}>
                <ArrowLeft size={13} aria-hidden="true" /> Not a university user? Return to JOB.READY
              </button>
            </div>
          </div>

          <div className="eki-legal">
            <button type="button" className="eki-link eki-link-dim" onClick={() => onLegal && onLegal("privacy")}>Privacy</button>
            <span aria-hidden="true">&middot;</span>
            <button type="button" className="eki-link eki-link-dim" onClick={() => onLegal && onLegal("terms")}>Terms</button>
          </div>
        </section>
      </div>
    </div>
  );
}

/* Scoped to `.eki-auth`. Kept small and well-formed. */
const EKI_AUTH_CSS = `
.eki-auth{
  position:fixed; inset:0; z-index:60; overflow-y:auto;
  font-family:var(--font);
  color:#EEF2FB;
  background:
    radial-gradient(1100px 720px at 78% -10%, rgba(59,130,246,0.22), rgba(59,130,246,0) 60%),
    radial-gradient(900px 640px at 8% 108%, rgba(34,211,238,0.10), rgba(34,211,238,0) 62%),
    linear-gradient(180deg, #0A0E1A, #0B1120 46%, #0A0E18);
  animation:ekiFade .5s ease both;
}
.eki-motif{
  position:absolute; inset:0; width:100%; height:100%; z-index:0; pointer-events:none;
  opacity:.9;
  -webkit-mask-image:linear-gradient(180deg, rgba(0,0,0,0.9), rgba(0,0,0,0.15) 78%, rgba(0,0,0,0));
          mask-image:linear-gradient(180deg, rgba(0,0,0,0.9), rgba(0,0,0,0.15) 78%, rgba(0,0,0,0));
}
.eki-node{ animation:ekiNode 4.5s ease-in-out infinite; transform-origin:center; }

.eki-header{
  position:relative; z-index:2;
  display:flex; align-items:center; justify-content:space-between; gap:16px;
  padding:20px clamp(20px,5vw,56px);
}
.eki-product-tag{ font-size:11.5px; letter-spacing:.14em; text-transform:uppercase; color:rgba(255,255,255,0.42); font-weight:600; }

.eki-wordmark{ font-weight:800; letter-spacing:-0.03em; color:#F5F8FF; line-height:1; }
.eki-wordmark sup{ font-size:0.5em; font-weight:700; top:-0.7em; margin-left:1px; }
.eki-wordmark-sm{ font-size:19px; }
.eki-wordmark-lg{ font-size:clamp(46px, 7vw, 78px); }

.eki-grid-wrap{
  position:relative; z-index:1;
  display:grid; grid-template-columns:1.05fr 0.95fr;
  gap:clamp(24px,5vw,72px);
  align-items:center;
  max-width:1180px; margin:0 auto;
  padding:clamp(16px,4vh,48px) clamp(20px,5vw,56px) 56px;
  min-height:calc(100vh - 72px);
}

.eki-hero{ animation:ekiRise .6s .05s ease both; }
.eki-brand{ margin-bottom:18px; }
.eki-expanded{
  margin-top:14px; font-size:12.5px; font-weight:600;
  letter-spacing:.19em; text-transform:uppercase; color:rgba(180,200,240,0.72);
}
.eki-proposition{
  margin:0; max-width:30ch;
  font-size:clamp(17px,2vw,22px); line-height:1.45; font-weight:500; color:#D5E0F2;
}
.eki-rule{ height:1px; width:120px; margin:28px 0; background:linear-gradient(90deg, rgba(148,178,255,0.5), rgba(148,178,255,0)); }

.eki-signals{ display:flex; flex-wrap:wrap; gap:14px; }
.eki-signal{
  flex:1 1 130px; min-width:120px;
  padding:14px 16px; border-radius:12px;
  background:rgba(255,255,255,0.035); border:1px solid rgba(255,255,255,0.08);
}
.eki-signal-label{ font-size:10.5px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; color:rgba(255,255,255,0.5); }
.eki-signal-value{ margin-top:6px; font-size:22px; font-weight:800; letter-spacing:-0.01em; color:#F2F6FF; font-variant-numeric:tabular-nums; }
.eki-signal-note{ margin-top:12px; font-size:11px; color:rgba(255,255,255,0.38); letter-spacing:.02em; }

.eki-panelwrap{ animation:ekiRise .6s .12s ease both; justify-self:end; width:100%; max-width:420px; }
.eki-panel{
  background:rgba(255,255,255,0.045);
  border:1px solid rgba(255,255,255,0.10);
  border-radius:18px;
  padding:clamp(22px,3vw,30px);
  box-shadow:0 30px 80px -30px rgba(0,0,0,0.6);
  -webkit-backdrop-filter:blur(14px); backdrop-filter:blur(14px);
}
.eki-panel-icon{
  width:40px; height:40px; border-radius:11px; margin-bottom:14px;
  display:flex; align-items:center; justify-content:center;
  background:rgba(59,130,246,0.16); color:#8fb3ff;
}
.eki-panel-title{ margin:0; font-size:21px; font-weight:800; letter-spacing:-0.01em; color:#F6F9FF; }
.eki-panel-sub{ margin:8px 0 20px; font-size:13px; line-height:1.55; color:rgba(226,234,248,0.7); }

.eki-alert{
  margin-bottom:14px; padding:10px 12px; border-radius:10px; font-size:12.5px; line-height:1.5;
  background:rgba(248,113,113,0.12); border:1px solid rgba(248,113,113,0.32); color:#fca5a5;
}

.eki-form{ display:block; }
.eki-label{ display:block; font-size:11.5px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:rgba(255,255,255,0.55); margin-bottom:7px; }
.eki-label-row{ display:flex; align-items:baseline; justify-content:space-between; gap:12px; margin-top:16px; }

.eki-input{
  width:100%; box-sizing:border-box;
  padding:12px 14px; font-family:var(--font); font-size:14.5px; color:#F3F6FF;
  background:rgba(9,14,26,0.55); border:1px solid rgba(255,255,255,0.14); border-radius:10px;
  transition:border-color .14s ease, box-shadow .14s ease;
}
.eki-input::placeholder{ color:rgba(255,255,255,0.34); }
.eki-input:focus, .eki-input:focus-within{ outline:none; border-color:#3B82F6; box-shadow:0 0 0 3px rgba(59,130,246,0.28); }
.eki-input-pw{ display:flex; align-items:stretch; padding:0; overflow:hidden; }
.eki-input-pw input{ flex:1; min-width:0; border:0; background:transparent; padding:12px 14px; font-family:var(--font); font-size:14.5px; color:#F3F6FF; }
.eki-input-pw input:focus{ outline:none; }
.eki-pwtoggle{
  flex-shrink:0; width:44px; display:flex; align-items:center; justify-content:center;
  background:transparent; border:0; border-left:1px solid rgba(255,255,255,0.12);
  color:rgba(255,255,255,0.55); cursor:pointer;
}
.eki-pwtoggle:hover{ color:#cdd9f0; }

.eki-btn{
  font-family:var(--font); font-size:14px; font-weight:700; cursor:pointer;
  border:1px solid transparent; border-radius:10px; padding:12px 18px;
  display:inline-flex; align-items:center; justify-content:center; gap:8px;
  transition:transform .12s ease, box-shadow .12s ease, background .12s ease, border-color .12s ease;
}
.eki-btn:disabled{ opacity:.6; cursor:not-allowed; }
.eki-btn-primary{ background:#3B82F6; color:#fff; box-shadow:0 14px 34px -14px rgba(59,130,246,0.7); }
.eki-btn-primary:hover:not(:disabled){ background:#2f74e8; transform:translateY(-1px); }
.eki-btn-ghost{ background:rgba(255,255,255,0.06); color:#EAF0FB; border-color:rgba(255,255,255,0.16); }
.eki-btn-ghost:hover{ background:rgba(255,255,255,0.1); }
.eki-btn-quiet{ background:transparent; color:rgba(255,255,255,0.6); }
.eki-btn-quiet:hover{ color:#EAF0FB; }
.eki-submit{ width:100%; margin-top:20px; }
.eki-actions{ display:flex; flex-direction:column; gap:10px; margin-top:6px; }

.eki-link{
  background:none; border:0; padding:0; cursor:pointer;
  font-family:var(--font); font-size:12.5px; font-weight:600; color:#8fb3ff;
}
.eki-link:hover{ color:#b9cdff; text-decoration:underline; }
.eki-link-dim{ color:rgba(255,255,255,0.42); font-weight:500; }
.eki-link-dim:hover{ color:rgba(255,255,255,0.7); }

.eki-panel-foot{ margin-top:20px; padding-top:16px; border-top:1px solid rgba(255,255,255,0.08); }
.eki-return{
  background:none; border:0; padding:0; cursor:pointer;
  font-family:var(--font); font-size:12.5px; font-weight:600; color:rgba(255,255,255,0.62);
  display:inline-flex; align-items:center; gap:6px;
}
.eki-return:hover{ color:#EAF0FB; }
.eki-legal{ display:flex; gap:10px; justify-content:center; align-items:center; margin-top:18px; font-size:11.5px; color:rgba(255,255,255,0.3); }

.eki-auth :focus-visible{ outline:2px solid #6f9bff; outline-offset:2px; border-radius:6px; }
.eki-spin{ animation:ekiSpin .8s linear infinite; }

@keyframes ekiFade{ from{ opacity:0; } to{ opacity:1; } }
@keyframes ekiRise{ from{ opacity:0; transform:translateY(12px); } to{ opacity:1; transform:none; } }
@keyframes ekiNode{ 0%,100%{ opacity:.2; r:3; } 50%{ opacity:.7; r:4.2; } }
@keyframes ekiSpin{ to{ transform:rotate(360deg); } }

@media (max-width:900px){
  .eki-grid-wrap{
    grid-template-columns:1fr; gap:26px; align-items:start;
    min-height:0; padding:8px 20px 40px;
  }
  .eki-panelwrap{ justify-self:stretch; max-width:none; order:2; animation-delay:.06s; }
  .eki-hero{ order:1; }
  .eki-wordmark-lg{ font-size:clamp(38px,13vw,52px); }
  .eki-expanded{ letter-spacing:.14em; }
  .eki-rule{ margin:20px 0; }
  .eki-signals{ gap:10px; }
  .eki-signal{ flex:1 1 92px; min-width:92px; padding:11px 12px; }
  .eki-signal-value{ font-size:18px; }
  .eki-motif{ opacity:.5; }
  .eki-header{ padding:16px 20px; }
}

@media (prefers-reduced-motion:reduce){
  .eki-auth, .eki-hero, .eki-panelwrap{ animation:none !important; }
  .eki-node, .eki-spin{ animation:none !important; }
  .eki-btn-primary:hover:not(:disabled){ transform:none; }
}
`;
