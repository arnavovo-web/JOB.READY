/* ================================================================== *
 * INSTITUTIONAL INSIGHTS — self-contained stylesheet
 * ------------------------------------------------------------------
 * Injected once via <style>{INSTITUTIONAL_CSS}</style> by
 * InstitutionalApp. It reuses the JOB.READY design language (the same
 * --navy / --blue / radius / shadow token VALUES as the student app's
 * TOKENS literal) but under an isolated `.ii-*` class namespace and its
 * own :root-less scoping so it can never affect the student app, and the
 * student app's App.cssUtilities / phase26 guards never see it.
 *
 * Discipline carried over from the student guardrails: plain class /
 * state selectors only (no `* > + ~ [ ::` beyond :state), and no literal
 * "}" inside any declaration value.
 * ================================================================== */

export const INSTITUTIONAL_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');

.ii-root{
  --ii-navy:#101828; --ii-navy-soft:#1D2939; --ii-blue:#2563EB; --ii-blue-dark:#1D4ED8;
  --ii-violet:#7C3AED; --ii-teal:#14B8A6;
  --ii-bg:#F6F8FB; --ii-card:#FFFFFF; --ii-border:#E2E8F0; --ii-border-soft:#EEF2F7;
  --ii-text:#0F172A; --ii-text-dim:#475569; --ii-text-faint:#94A3B8;
  --ii-good:#0F9D6E; --ii-warn:#D97706; --ii-bad:#DC2626;
  --ii-good-bg:#E7F8F1; --ii-warn-bg:#FEF3E2; --ii-bad-bg:#FEF2F2; --ii-info-bg:#EFF4FF;
  --ii-track:#EEF2F7;
  --ii-r-sm:10px; --ii-r-md:12px; --ii-r-lg:16px; --ii-r-pill:999px;
  --ii-shadow-xs:0 1px 2px rgba(16,24,40,0.04);
  --ii-shadow-sm:0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.05);
  --ii-shadow-md:0 2px 4px rgba(16,24,40,0.04), 0 10px 24px rgba(16,24,40,0.08);
  --ii-shadow-lg:0 4px 8px rgba(16,24,40,0.04), 0 22px 48px rgba(16,24,40,0.12);
  --ii-font:'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --ii-ease:cubic-bezier(.4,0,.2,1);

  font-family:var(--ii-font); color:var(--ii-text); background:var(--ii-bg);
  min-height:100vh; -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility;
}
.ii-root *{ box-sizing:border-box; }

/* ---- layout ------------------------------------------------------- */
.ii-shell{ display:flex; min-height:100vh; }
.ii-sidebar{ width:248px; flex-shrink:0; background:var(--ii-navy); color:#fff; display:flex; flex-direction:column; padding:22px 16px; position:sticky; top:0; height:100vh; }
.ii-main{ flex:1; min-width:0; display:flex; flex-direction:column; }
.ii-content{ width:100%; max-width:1180px; margin:0 auto; padding:clamp(24px,4vw,40px) clamp(18px,4vw,40px); }
.ii-topbar{ display:flex; align-items:center; justify-content:space-between; gap:16px; padding:14px clamp(18px,4vw,40px); border-bottom:1px solid var(--ii-border); background:var(--ii-card); position:sticky; top:0; z-index:20; }

.ii-brand{ display:flex; align-items:center; gap:9px; font-weight:800; font-size:15px; letter-spacing:-0.01em; margin-bottom:24px; }
.ii-brand-mark{ width:26px; height:26px; border-radius:8px; background:linear-gradient(135deg, var(--ii-blue), var(--ii-violet)); display:flex; align-items:center; justify-content:center; color:#fff; font-weight:800; font-size:13px; }
.ii-brand-sub{ font-size:11px; font-weight:700; letter-spacing:0.06em; text-transform:uppercase; color:rgba(255,255,255,0.55); }

.ii-nav{ display:flex; flex-direction:column; gap:2px; margin-top:6px; }
.ii-navlink{ display:flex; align-items:center; gap:11px; padding:9px 11px; border-radius:var(--ii-r-sm); color:rgba(255,255,255,0.72); font-size:13.5px; font-weight:600; cursor:pointer; border:none; background:transparent; width:100%; text-align:left; transition:background var(--ii-ease) 140ms, color var(--ii-ease) 140ms; }
.ii-navlink:hover{ background:rgba(255,255,255,0.08); color:#fff; }
.ii-navlink-active{ background:rgba(255,255,255,0.14); color:#fff; }
.ii-nav-spacer{ flex:1; }

/* ---- typography ------------------------------------------------- */
.ii-h1{ font-size:clamp(21px,2.6vw,27px); font-weight:800; letter-spacing:-0.02em; line-height:1.15; color:var(--ii-navy); margin:0; }
.ii-h2{ font-size:17px; font-weight:800; letter-spacing:-0.01em; line-height:1.3; color:var(--ii-navy); margin:0; }
.ii-h3{ font-size:14px; font-weight:700; line-height:1.4; color:var(--ii-navy); margin:0; }
.ii-text{ font-size:14px; line-height:1.55; color:var(--ii-text-dim); margin:0; }
.ii-text-sm{ font-size:12.5px; line-height:1.5; color:var(--ii-text-dim); margin:0; }
.ii-eyebrow{ font-size:11px; font-weight:700; letter-spacing:0.06em; text-transform:uppercase; color:var(--ii-text-faint); margin:0; }
.ii-pagehead{ margin-bottom:26px; }
.ii-pagehead-title-row{ display:flex; align-items:flex-start; justify-content:space-between; gap:16px; flex-wrap:wrap; }

/* ---- cards / grid --------------------------------------------- */
.ii-card{ background:var(--ii-card); border:1px solid var(--ii-border); border-radius:var(--ii-r-lg); padding:20px; box-shadow:var(--ii-shadow-xs); }
.ii-card-pad-lg{ padding:24px; }
.ii-grid{ display:grid; gap:16px; }
.ii-grid-2{ grid-template-columns:repeat(2, minmax(0,1fr)); }
.ii-grid-3{ grid-template-columns:repeat(3, minmax(0,1fr)); }
.ii-grid-4{ grid-template-columns:repeat(4, minmax(0,1fr)); }
.ii-section{ margin-bottom:28px; }
.ii-row{ display:flex; align-items:center; gap:10px; }
.ii-row-wrap{ display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.ii-spread{ display:flex; align-items:center; justify-content:space-between; gap:12px; }

/* ---- stat tile ---------------------------------------------- */
.ii-stat{ display:flex; flex-direction:column; gap:7px; background:var(--ii-card); border:1px solid var(--ii-border); border-radius:var(--ii-r-lg); padding:16px 18px; box-shadow:var(--ii-shadow-xs); }
.ii-stat-label{ font-size:12px; font-weight:700; letter-spacing:0.03em; text-transform:uppercase; color:var(--ii-text-faint); }
.ii-stat-value{ font-size:29px; font-weight:800; letter-spacing:-0.02em; line-height:1; color:var(--ii-navy); font-variant-numeric:tabular-nums; }
.ii-stat-value-sm{ font-size:20px; }
.ii-stat-unit{ font-size:14px; font-weight:700; color:var(--ii-text-faint); }
.ii-stat-sub{ font-size:12px; font-weight:600; color:var(--ii-text-dim); }

/* ---- meters / bars ---------------------------------------- */
.ii-meter{ height:8px; width:100%; background:var(--ii-track); border-radius:var(--ii-r-pill); overflow:hidden; }
.ii-meter-fill{ height:100%; border-radius:var(--ii-r-pill); background:var(--ii-blue); transition:width .6s var(--ii-ease); }
.ii-meter-fill-good{ background:var(--ii-good); }
.ii-meter-fill-warn{ background:var(--ii-warn); }
.ii-meter-fill-bad{ background:var(--ii-bad); }
.ii-bar-track{ display:flex; align-items:center; gap:12px; }
.ii-bar-label{ width:190px; flex-shrink:0; font-size:13px; font-weight:600; color:var(--ii-text); }
.ii-bar-val{ width:44px; flex-shrink:0; text-align:right; font-size:13px; font-weight:700; color:var(--ii-navy); font-variant-numeric:tabular-nums; }

/* ---- badges / pills -------------------------------------- */
.ii-badge{ display:inline-flex; align-items:center; gap:5px; font-size:11.5px; font-weight:700; padding:3px 9px; border-radius:var(--ii-r-pill); line-height:1.4; }
.ii-badge-good{ background:var(--ii-good-bg); color:var(--ii-good); }
.ii-badge-warn{ background:var(--ii-warn-bg); color:var(--ii-warn); }
.ii-badge-bad{ background:var(--ii-bad-bg); color:var(--ii-bad); }
.ii-badge-info{ background:var(--ii-info-bg); color:var(--ii-blue-dark); }
.ii-badge-neutral{ background:var(--ii-border-soft); color:var(--ii-text-dim); }

/* ---- controls ------------------------------------------- */
.ii-btn{ display:inline-flex; align-items:center; justify-content:center; gap:7px; font-family:var(--ii-font); font-size:13.5px; font-weight:700; padding:9px 15px; border-radius:var(--ii-r-sm); border:1px solid transparent; cursor:pointer; transition:transform 110ms var(--ii-ease), box-shadow 110ms var(--ii-ease), background 110ms var(--ii-ease); }
.ii-btn:hover{ transform:translateY(-1px); box-shadow:var(--ii-shadow-md); }
.ii-btn:active{ transform:translateY(0); }
.ii-btn:disabled{ opacity:0.55; cursor:not-allowed; box-shadow:none; transform:none; }
.ii-btn-primary{ background:var(--ii-navy); color:#fff; }
.ii-btn-accent{ background:var(--ii-blue); color:#fff; }
.ii-btn-ghost{ background:var(--ii-card); color:var(--ii-navy); border-color:var(--ii-border); }
.ii-btn-sm{ padding:6px 11px; font-size:12.5px; }

.ii-input{ width:100%; padding:10px 13px; font-family:var(--ii-font); font-size:14px; color:var(--ii-text); background:var(--ii-card); border:1.5px solid var(--ii-border); border-radius:var(--ii-r-sm); transition:border-color 110ms var(--ii-ease), box-shadow 110ms var(--ii-ease); }
.ii-input:focus{ outline:none; border-color:var(--ii-blue); box-shadow:0 0 0 3px rgba(37,99,235,0.14); }
.ii-select{ appearance:none; -webkit-appearance:none; padding-right:34px; cursor:pointer; background-repeat:no-repeat; background-position:right 11px center; background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%2394A3B8' stroke-width='2' fill='none' stroke-linecap='round'/%3E%3C/svg%3E"); }
.ii-label{ font-size:12px; font-weight:700; color:var(--ii-text); display:block; margin-bottom:6px; }

/* ---- alert / empty ------------------------------------- */
.ii-alert{ display:flex; gap:10px; align-items:flex-start; padding:12px 14px; border-radius:var(--ii-r-md); font-size:13px; line-height:1.5; border:1px solid transparent; }
.ii-alert-info{ background:var(--ii-info-bg); color:var(--ii-blue-dark); border-color:#CBDBFF; }
.ii-alert-warn{ background:var(--ii-warn-bg); color:#9A5B08; border-color:#F5D9AE; }
.ii-alert-error{ background:var(--ii-bad-bg); color:var(--ii-bad); border-color:#F6C9C9; }
.ii-empty{ display:flex; flex-direction:column; align-items:center; text-align:center; gap:8px; padding:44px 24px; color:var(--ii-text-dim); }
.ii-empty-icon{ display:flex; align-items:center; justify-content:center; width:46px; height:46px; border-radius:var(--ii-r-md); background:var(--ii-border-soft); color:var(--ii-text-faint); }

/* ---- misc -------------------------------------------- */
.ii-divider{ height:1px; background:var(--ii-border); border:none; margin:20px 0; }
.ii-fade{ animation:iiFade .3s ease both; }
.ii-muted{ color:var(--ii-text-faint); }
.ii-mono-num{ font-variant-numeric:tabular-nums; }
.ii-anon-note{ font-size:11.5px; color:var(--ii-text-faint); display:flex; align-items:center; gap:6px; margin-top:4px; }
.ii-authwrap{ min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; background:var(--ii-bg); }
.ii-authcard{ width:100%; max-width:400px; background:var(--ii-card); border:1px solid var(--ii-border); border-radius:var(--ii-r-lg); padding:30px; box-shadow:var(--ii-shadow-lg); }
.ii-spinner{ width:34px; height:34px; border-radius:50%; border:3px solid var(--ii-border); border-top-color:var(--ii-blue); animation:iiSpin .8s linear infinite; }
.ii-loadwrap{ min-height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px; color:var(--ii-text-dim); font-size:13px; }

/* ---- findings ------------------------------------------------ */
.ii-findings{ display:flex; flex-direction:column; gap:10px; }
.ii-finding{ display:flex; gap:12px; align-items:flex-start; padding:13px 15px; border-radius:var(--ii-r-md); border:1px solid var(--ii-border); background:var(--ii-card); }
.ii-finding-critical{ border-color:#F6C9C9; background:linear-gradient(180deg, var(--ii-bad-bg), var(--ii-card) 60%); }
.ii-finding-watch{ border-color:#F5D9AE; background:linear-gradient(180deg, var(--ii-warn-bg), var(--ii-card) 60%); }
.ii-finding-positive{ border-color:#BBEBD9; background:linear-gradient(180deg, var(--ii-good-bg), var(--ii-card) 62%); }
.ii-finding-neutral{ border-color:var(--ii-border); }
.ii-finding-tag{ flex-shrink:0; display:inline-flex; align-items:center; gap:4px; font-size:10.5px; font-weight:800; letter-spacing:0.03em; text-transform:uppercase; padding:3px 8px; border-radius:var(--ii-r-pill); margin-top:1px; }
.ii-finding-head{ font-size:14px; font-weight:700; color:var(--ii-navy); line-height:1.35; }
.ii-finding-detail{ font-size:12.5px; line-height:1.5; color:var(--ii-text-dim); margin-top:3px; }

/* ---- score bars -------------------------------------------- */
.ii-bars{ margin-top:4px; }
.ii-bar-wrap{ flex:1; display:flex; align-items:center; }
.ii-bar-tail{ min-width:104px; display:flex; align-items:center; justify-content:flex-end; gap:6px; }
.ii-meter-target{ position:absolute; top:-2px; bottom:-2px; width:2px; background:var(--ii-navy); opacity:0.55; border-radius:2px; }
.ii-delta{ display:inline-flex; align-items:center; gap:3px; font-size:11px; font-weight:800; padding:2px 6px; border-radius:var(--ii-r-pill); font-variant-numeric:tabular-nums; }
.ii-delta-good{ background:var(--ii-good-bg); color:var(--ii-good); }
.ii-delta-bad{ background:var(--ii-bad-bg); color:var(--ii-bad); }
.ii-delta-neutral{ background:var(--ii-border-soft); color:var(--ii-text-dim); }
.ii-legend{ display:flex; align-items:center; gap:7px; font-size:11.5px; color:var(--ii-text-faint); margin-top:8px; }
.ii-legend-target{ display:inline-block; width:2px; height:12px; background:var(--ii-navy); opacity:0.55; }

/* ---- distribution bar ------------------------------------- */
.ii-distbar{ display:flex; height:26px; border-radius:var(--ii-r-sm); overflow:hidden; background:var(--ii-track); }
.ii-distbar-seg{ height:100%; min-width:2px; }
.ii-distlegend{ display:flex; flex-wrap:wrap; gap:14px; margin-top:10px; font-size:12px; color:var(--ii-text-dim); }
.ii-distlegend-item{ display:inline-flex; align-items:center; gap:6px; }
.ii-dot{ width:9px; height:9px; border-radius:var(--ii-r-pill); flex-shrink:0; }

/* ---- diverging delta bars -------------------------------- */
.ii-deltabars{ display:flex; flex-direction:column; gap:9px; }
.ii-deltarow{ display:flex; align-items:center; gap:12px; }
.ii-deltatrack{ position:relative; flex:1; height:14px; background:var(--ii-track); border-radius:var(--ii-r-pill); }
.ii-deltamid{ position:absolute; left:50%; top:-3px; bottom:-3px; width:2px; background:var(--ii-text-faint); }
.ii-deltafill{ position:absolute; top:0; bottom:0; border-radius:var(--ii-r-pill); }
.ii-deltafill-up{ background:var(--ii-good); }
.ii-deltafill-down{ background:var(--ii-bad); }

/* ---- trend ---------------------------------------------- */
.ii-trend{ width:100%; height:96px; display:block; }
.ii-trend-area{ fill:rgba(37,99,235,0.10); stroke:none; }
.ii-trend-line{ fill:none; stroke:var(--ii-blue); stroke-width:2; vector-effect:non-scaling-stroke; }
.ii-trend-target{ stroke:var(--ii-navy); stroke-opacity:0.35; stroke-width:1; stroke-dasharray:3 3; vector-effect:non-scaling-stroke; }
.ii-trend-dot{ fill:var(--ii-blue); }
.ii-trend-axis{ display:flex; justify-content:space-between; font-size:11px; color:var(--ii-text-faint); margin-top:6px; }

/* ---- opportunities ------------------------------------- */
.ii-opps{ list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:12px; }
.ii-opp{ display:flex; gap:14px; align-items:flex-start; }
.ii-opp-rank{ flex-shrink:0; width:26px; height:26px; border-radius:var(--ii-r-pill); background:var(--ii-navy); color:#fff; font-size:12px; font-weight:800; display:flex; align-items:center; justify-content:center; }
.ii-opp-body{ flex:1; min-width:0; display:flex; flex-direction:column; gap:6px; }
.ii-opp-head{ display:flex; align-items:center; gap:8px; flex-wrap:wrap; font-size:13.5px; color:var(--ii-navy); }
.ii-opp-meter{ display:flex; align-items:center; gap:10px; }
.ii-opp-facts{ margin:0; }

/* ---- callouts / suppressed --------------------------- */
.ii-callout{ border-radius:var(--ii-r-md); border:1px solid var(--ii-border); padding:14px 16px; }
.ii-callout-good{ border-color:#BBEBD9; background:var(--ii-good-bg); }
.ii-callout-bad{ border-color:#F6C9C9; background:var(--ii-bad-bg); }
.ii-suppressed-block{ display:flex; align-items:center; gap:9px; padding:14px 16px; border-radius:var(--ii-r-md); border:1px dashed var(--ii-border); background:var(--ii-bg); color:var(--ii-text-dim); font-size:12.5px; }

@keyframes iiFade{ from{ opacity:0; transform:translateY(6px); } to{ opacity:1; transform:translateY(0); } }
@keyframes iiSpin{ to{ transform:rotate(360deg); } }

@media (max-width:1040px){
  .ii-grid-4{ grid-template-columns:repeat(2, minmax(0,1fr)); }
  .ii-grid-3{ grid-template-columns:repeat(2, minmax(0,1fr)); }
}
@media (max-width:820px){
  .ii-shell{ flex-direction:column; }
  .ii-sidebar{ width:100%; height:auto; position:static; flex-direction:row; align-items:center; gap:8px; padding:10px 12px; overflow-x:auto; }
  .ii-sidebar .ii-brand{ margin-bottom:0; margin-right:8px; }
  .ii-sidebar .ii-brand-sub{ display:none; }
  .ii-nav{ flex-direction:row; margin-top:0; gap:4px; }
  .ii-navlink{ white-space:nowrap; padding:7px 10px; }
  .ii-nav-spacer{ display:none; }
}
@media (max-width:640px){
  .ii-grid-2, .ii-grid-3, .ii-grid-4{ grid-template-columns:minmax(0,1fr); }
  .ii-bar-label{ width:130px; }
}
`;
