<script lang="ts">
  import { page } from "$app/stores";
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";
  import { connectSocket, getSocket } from "$lib/socket/client.js";
  import { storageGet, storageSet } from "$lib/storage.js";
  import { gameStore } from "$lib/stores/game.js";
  import type { JoinAck } from "@scripturejam/types";
  import Stage from "$lib/components/Stage.svelte";
  import ConnectionPill from "$lib/components/ConnectionPill.svelte";
  import AvatarPicker from "./AvatarPicker.svelte";

  let code = $derived($page.params.code ?? "");
  let nickname = $state("");
  let avatarId = $state("");
  let avatarDisplayName = $state("");
  let joining = $state(false);
  let error = $state<string | null>(null);
  let showAvatarPicker = $state(false);
  let mode = $derived.by<"individual" | "group">(() => {
    const raw = storageGet(`sj_host_scope_${code}`);
    if (!raw) return "individual";
    try {
      return (JSON.parse(raw).mode ?? "individual") as "individual" | "group";
    } catch {
      return "individual";
    }
  });

  let largeText = $state(false);
  let highContrast = $state(false);

  onMount(() => {
    const raw = storageGet("sj_a11y");
    if (raw) {
      try {
        const prefs = JSON.parse(raw) as { largeText: boolean; highContrast: boolean };
        largeText = prefs.largeText ?? false;
        highContrast = prefs.highContrast ?? false;
      } catch {
        // ignore corrupt pref
      }
    }
    applyA11y();

    const resumeRaw = storageGet(`sj_resume_${code}`);
    if (resumeRaw) {
      try {
        const resume = JSON.parse(resumeRaw) as {
          playerId: string;
          resumeToken: string;
          nickname: string;
          avatarId: string;
        };
        const socket = connectSocket();
        socket.emit(
          "JOIN",
          {
            code,
            nickname: resume.nickname,
            avatarId: resume.avatarId,
            resumeToken: resume.resumeToken,
          },
          (ack: JoinAck) => {
            if (ack.ok) {
              gameStore.setJoined(
                ack.playerId,
                resume.nickname,
                resume.avatarId,
                ack.resumeToken,
                code
              );
              storageSet(
                `sj_resume_${code}`,
                JSON.stringify({
                  playerId: ack.playerId,
                  resumeToken: ack.resumeToken,
                  nickname: resume.nickname,
                  avatarId: resume.avatarId,
                })
              );
              goto(`/p/${code}`);
            }
          }
        );
      } catch {
        // ignore corrupt resume data
      }
    }
  });

  function applyA11y() {
    if (typeof document === "undefined") return;
    document.documentElement.classList.toggle("large-text", largeText);
    document.documentElement.classList.toggle("high-contrast", highContrast);
    storageSet("sj_a11y", JSON.stringify({ largeText, highContrast }));
  }

  function toggleLargeText() {
    largeText = !largeText;
    applyA11y();
  }

  function toggleHighContrast() {
    highContrast = !highContrast;
    applyA11y();
  }

  const errorMessages: Record<string, string> = {
    session_not_found: "Session not found",
    nickname_taken: "That name is taken",
    avatar_invalid: "Avatar not available",
    wrong_mode_avatar: "Avatar not available for this mode",
    session_ended: "This session has ended",
    session_full: "Session is full",
  };

  async function handleJoin(e: SubmitEvent) {
    e.preventDefault();
    if (!nickname.trim() || !avatarId) return;
    joining = true;
    error = null;

    const socket = connectSocket();

    const doJoin = () => {
      socket.emit(
        "JOIN",
        { code, nickname: nickname.trim(), avatarId },
        (ack: JoinAck) => {
          if (ack.ok) {
            gameStore.setJoined(
              ack.playerId,
              nickname.trim(),
              avatarId,
              ack.resumeToken,
              code
            );
            storageSet(
              `sj_resume_${code}`,
              JSON.stringify({
                playerId: ack.playerId,
                resumeToken: ack.resumeToken,
                nickname: nickname.trim(),
                avatarId,
              })
            );
            goto(`/p/${code}`);
          } else {
            error = errorMessages[ack.reason] ?? "Could not join — please try again";
            joining = false;
          }
        }
      );
    };

    if (socket.connected) {
      doJoin();
    } else {
      socket.once("connect", doJoin);
    }
  }

  function handleAvatarSelect(id: string) {
    avatarId = id;
    avatarDisplayName = id;
    showAvatarPicker = false;
  }
</script>

{#if showAvatarPicker}
  <AvatarPicker
    {mode}
    onSelect={handleAvatarSelect}
    onBack={() => (showAvatarPicker = false)}
  />
{:else}
  <Stage confetti={true}>
    {#snippet meta()}
      <ConnectionPill connected={true} label="Join" />
    {/snippet}

    <div class="main">
      <div class="join-card card">
        <form onsubmit={handleJoin} class="join-form">
          <!-- Avatar -->
          <div class="avatar-pick">
            <button type="button" onclick={() => (showAvatarPicker = true)} aria-label="Change avatar">
              <div class="avatar">
                {#if avatarId}
                  <img
                    src="/api/avatars/{avatarId}/monogram.svg?name={encodeURIComponent(avatarDisplayName || avatarId)}"
                    alt=""
                  />
                {:else}
                  <span class="placeholder">+</span>
                {/if}
              </div>
            </button>
            <span class="hint">tap to change</span>
          </div>

          <!-- Session code -->
          <div class="field">
            <input
              id="code"
              type="text"
              value={code}
              class="code"
              maxlength="6"
              readonly={!!$page.params.code}
              aria-label="Session code"
            />
          </div>

          <!-- Your name / Team name -->
          <div class="field">
            <label for="nickname">{mode === "group" ? "Team name" : "Your name"}</label>
            <input
              id="nickname"
              type="text"
              bind:value={nickname}
              class="name"
              maxlength="24"
              placeholder={mode === "group" ? "Enter team name" : "Enter your name"}
              required
              autocomplete="off"
            />
          </div>

          {#if error}
            <p class="error" role="alert">{error}</p>
          {/if}

          <button type="submit" class="join-btn" disabled={!nickname.trim() || !avatarId || joining}>
            {joining ? "Joining…" : "Join quiz →"}
          </button>
        </form>

        <div class="access">
          <span class="label">Accessibility</span>
          <label>
            <input type="checkbox" checked={largeText} onchange={toggleLargeText} />
            <span>Large text</span>
          </label>
          <label>
            <input type="checkbox" checked={highContrast} onchange={toggleHighContrast} />
            <span>High contrast</span>
          </label>
        </div>
      </div>
    </div>
  </Stage>
{/if}

<style>
  .main {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    padding: 16px 16px 24px;
    position: relative;
    z-index: 10;
  }

  .join-card {
    padding: 28px 24px;
    width: 100%;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 18px;
    border-top: 6px solid var(--gold);
    position: relative;
  }

  .join-form {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  .avatar-pick {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }
  .avatar-pick button {
    width: 104px;
    height: 104px;
    border-radius: 50%;
    border: 4px solid var(--gold);
    background: var(--white);
    display: grid;
    place-items: center;
    transition: transform 0.16s ease, box-shadow 0.16s ease;
    position: relative;
    overflow: hidden;
    box-shadow: 0 10px 26px rgba(0, 0, 0, 0.16);
    animation: pulseRing 2.2s ease-in-out infinite;
  }
  .avatar-pick button:hover {
    transform: translateY(-3px);
    box-shadow: 0 16px 34px rgba(0, 0, 0, 0.22);
  }
  @keyframes pulseRing {
    0%, 100% { box-shadow: 0 0 0 0 rgba(255, 201, 60, 0.5); }
    50%      { box-shadow: 0 0 0 14px rgba(255, 201, 60, 0); }
  }
  .avatar-pick .avatar {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: rgba(42, 26, 94, 0.06);
  }
  .avatar-pick .avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 50%;
    display: block;
  }
  .avatar-pick .placeholder {
    font-size: 24px;
    color: var(--ink-soft);
  }
  .avatar-pick .hint {
    font-size: 13px;
    font-weight: 600;
    color: var(--ink-soft);
  }

  .field label {
    display: block;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--ink-soft);
    margin-bottom: 6px;
  }
  .field :global(input) {
    width: 100%;
    height: 58px;
    border: 2px solid rgba(42, 26, 94, 0.16);
    border-radius: 14px;
    padding: 0 14px;
    font-size: 22px;
    text-align: center;
    background: var(--white);
    color: var(--ink);
    outline: none;
    transition: border-color 0.16s ease, box-shadow 0.16s ease;
  }
  .field :global(input:focus) {
    border-color: var(--grad-a);
    box-shadow: 0 0 0 4px rgba(123, 47, 247, 0.15);
  }
  .field :global(input.code) {
    font-family: "Poppins", monospace;
    letter-spacing: 0.3em;
    text-transform: uppercase;
    font-weight: 800;
  }
  .field :global(input.name) {
    text-align: center;
  }

  .error {
    color: var(--color-option-a);
    font-size: 14px;
    font-weight: 600;
    margin: 0;
  }

  .join-btn {
    width: 100%;
    height: 58px;
    border: 0;
    border-radius: 14px;
    background: var(--grad-a);
    color: #fff;
    font-weight: 800;
    font-size: 20px;
    box-shadow: 0 8px 20px rgba(123, 47, 247, 0.35);
    transition: transform 0.16s ease, box-shadow 0.16s ease, background 0.16s ease;
  }
  .join-btn:hover:not(:disabled) {
    transform: translateY(-3px);
    box-shadow: 0 14px 30px rgba(123, 47, 247, 0.42);
    background: var(--grad-b);
  }
  .join-btn:disabled {
    opacity: 0.5;
  }

  .access {
    border-top: 1px solid rgba(42, 26, 94, 0.12);
    padding-top: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .access .label {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }
  .access label {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 40px;
    cursor: pointer;
    font-size: 15px;
    font-weight: 600;
    color: var(--ink);
  }
  .access input {
    width: 20px;
    height: 20px;
    accent-color: var(--grad-a);
  }
</style>
