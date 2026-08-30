<script lang="ts">
  import { page } from "$app/stores";
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";
  import { connectSocket, getSocket } from "$lib/socket/client.js";
  import { storageGet, storageSet } from "$lib/storage.js";
  import { gameStore } from "$lib/stores/game.js";
  import type { JoinAck } from "@scripturejam/types";
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
  <main class="min-h-screen flex flex-col items-center justify-center p-4 bg-paper">
    <div class="w-full max-w-sm bg-paper-2 rounded-[34px] border border-rule p-[34px_24px] space-y-5">
      <!-- Top bar -->
      <div class="flex items-center justify-between h-[54px] border-b border-rule pb-2">
        <span class="text-[19px] text-ink-38">quiz.local</span>
        <span class="text-[19px] font-mono text-ink-38 tracking-widest">{code}</span>
      </div>

      <form onsubmit={handleJoin} class="space-y-5">
        <!-- Avatar -->
        <div class="flex flex-col items-center gap-2">
          <button
            type="button"
            onclick={() => (showAvatarPicker = true)}
            class="relative"
            aria-label="Choose avatar"
          >
            {#if avatarId}
              <img
                src="/api/avatars/{avatarId}/monogram.svg?name={encodeURIComponent(avatarDisplayName || avatarId)}"
                alt=""
                class="w-[104px] h-[104px] rounded-full border border-[rgba(30,58,95,.2)] bg-navy-8"
              />
            {:else}
              <div class="w-[104px] h-[104px] rounded-full bg-navy-8 border border-[rgba(30,58,95,.2)]"></div>
            {/if}
          </button>
          <p class="text-[19px] text-ink-60">tap to change</p>
        </div>

        <!-- Session code -->
        <div>
          <input
            id="code"
            type="text"
            value={code}
            class="w-full h-[58px] border border-rule rounded-[10px] px-3 py-2 text-[28px] font-mono tracking-[.3em] uppercase text-center bg-paper-2 text-ink"
            maxlength="6"
            readonly={!!$page.params.code}
            aria-label="Session code"
          />
        </div>

        <!-- Your name / Team name -->
        <div>
          <label for="nickname" class="block text-[21px] font-semibold uppercase tracking-[.16em] text-ink-38 mb-1">
            {mode === "group" ? "Team name" : "Your name"}
          </label>
          <input
            id="nickname"
            type="text"
            bind:value={nickname}
            class="w-full h-[58px] border border-rule rounded-[10px] px-3 py-2 text-[24px] min-h-[58px] bg-paper-2 text-ink caret-navy"
            maxlength="24"
            placeholder={mode === "group" ? "Enter team name" : "Enter your name"}
            required
            autocomplete="off"
          />
        </div>

        {#if error}
          <p class="text-red-600 text-sm font-medium" role="alert">{error}</p>
        {/if}

        <button
          type="submit"
          class="w-full bg-navy text-paper rounded-[10px] px-4 py-3 font-semibold text-[25px] min-h-[58px] disabled:opacity-50 hover:bg-navy/90 transition-colors"
          disabled={!nickname.trim() || !avatarId || joining}
        >
          {joining ? "Joining…" : "Join quiz →"}
        </button>
      </form>

      <!-- Accessibility block -->
      <div class="border-t border-rule pt-4 space-y-2">
        <p class="text-xs font-semibold uppercase tracking-[.16em] text-ink-38">accessibility</p>
        <label class="flex items-center gap-3 min-h-[44px] cursor-pointer">
          <input
            type="checkbox"
            checked={largeText}
            onchange={toggleLargeText}
            class="w-5 h-5 rounded border-rule text-navy focus:ring-navy"
          />
          <span class="text-sm text-ink">Large text</span>
        </label>
        <label class="flex items-center gap-3 min-h-[44px] cursor-pointer">
          <input
            type="checkbox"
            checked={highContrast}
            onchange={toggleHighContrast}
            class="w-5 h-5 rounded border-rule text-navy focus:ring-navy"
          />
          <span class="text-sm text-ink">High contrast</span>
        </label>
      </div>
    </div>
  </main>
{/if}