<script lang="ts">
  import { page } from "$app/stores";
  import Stage from "$lib/components/Stage.svelte";

  let code = $derived($page.params.code ?? "");
  let copyDone = $state(false);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      copyDone = true;
      setTimeout(() => (copyDone = false), 2000);
    } catch {
      // clipboard not available
    }
  }
</script>

<Stage>
  {#snippet meta()}
    <span class="pill">Session {code}</span>
  {/snippet}

  <div class="main">
    <div class="card results-card">
      <h1>ScriptureJam</h1>
      <p class="subtitle">Results</p>

      <div class="code-box">
        <p class="code-label">Session code</p>
        <p class="code-value">{code}</p>
      </div>

      <div class="qr-box">
        <img src="/api/sessions/{code}/qr.svg" alt="QR code for session {code}" />
        <p class="muted">Scan to join or view this session</p>
      </div>

      <p class="muted">
        Results for this session are available to participants who completed the quiz.
        The host can share the link below.
      </p>

      <div class="link-row">
        <code class="link-text">
          {typeof window !== "undefined" ? window.location.href : `/r/${code}`}
        </code>
        <button type="button" onclick={copyLink} class="copy-btn" aria-label="Copy link">
          {copyDone ? "✓" : "Copy"}
        </button>
      </div>

      <a href="/j/{code}" class="join-btn">Join this session</a>
    </div>
  </div>
</Stage>

<style>
  .main {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px 16px 40px;
    position: relative;
    z-index: 10;
  }

  .results-card {
    width: 100%;
    max-width: 420px;
    padding: 34px 30px;
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: 18px;
    border-top: 6px solid var(--gold);
  }
  .results-card h1 {
    margin: 0;
    font-size: 26px;
    font-weight: 900;
    color: var(--ink);
  }
  .subtitle {
    margin: -12px 0 0;
    font-size: 14px;
    color: var(--ink-soft);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .code-box {
    background: rgba(123, 47, 247, 0.08);
    border: 2px solid rgba(123, 47, 247, 0.22);
    border-radius: 18px;
    padding: 18px;
  }
  .code-label {
    margin: 0 0 4px;
    font-size: 11px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink-soft);
    font-weight: 700;
  }
  .code-value {
    margin: 0;
    font-size: 36px;
    font-weight: 900;
    font-family: "Poppins", monospace;
    letter-spacing: 0.2em;
    color: var(--ink);
  }

  .qr-box {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }
  .qr-box img {
    width: 160px;
    height: 160px;
    background: var(--white);
    border-radius: 14px;
    padding: 8px;
    border: 2px solid rgba(42, 26, 94, 0.12);
  }

  .muted {
    margin: 0;
    color: var(--ink-soft);
    font-size: 14px;
  }

  .link-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .link-text {
    flex: 1;
    min-width: 0;
    text-align: left;
    font-size: 12px;
    color: var(--grad-a);
    background: rgba(123, 47, 247, 0.08);
    border-radius: 10px;
    padding: 10px 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .copy-btn {
    flex-shrink: 0;
    min-height: 44px;
    min-width: 44px;
    padding: 0 14px;
    border: 0;
    border-radius: 10px;
    background: var(--grad-a);
    color: #fff;
    font-weight: 700;
    font-size: 13px;
    transition: background 0.16s ease;
  }
  .copy-btn:hover {
    background: var(--grad-b);
  }

  .join-btn {
    display: block;
    width: 100%;
    height: 54px;
    line-height: 54px;
    border-radius: 14px;
    background: var(--color-option-d);
    color: #fff;
    font-weight: 800;
    font-size: 17px;
    text-decoration: none;
    transition: filter 0.16s ease, transform 0.16s ease;
  }
  .join-btn:hover {
    filter: brightness(1.08);
    transform: translateY(-2px);
  }
</style>
