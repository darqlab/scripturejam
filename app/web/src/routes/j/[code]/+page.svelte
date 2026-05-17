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
  <main class="min-h-screen flex flex-col items-center justify-center p-4 bg-gray-50">
    <div class="w-full max-w-sm bg-white rounded-2xl shadow-md p-6 space-y-5">
      <h1 class="text-2xl font-bold text-center text-blue-700">scripturejam</h1>

      <form onsubmit={handleJoin} class="space-y-4">
        <div>
          <label for="code" class="block text-sm font-medium text-gray-700 mb-1">Session code</label>
          <input
            id="code"
            type="text"
            value={code}
            class="w-full border border-gray-300 rounded-lg px-3 py-2 text-lg tracking-widest font-mono uppercase text-center"
            maxlength="6"
            readonly={!!$page.params.code}
          />
        </div>

        <div>
          <label for="nickname" class="block text-sm font-medium text-gray-700 mb-1">Your name</label>
          <input
            id="nickname"
            type="text"
            bind:value={nickname}
            class="w-full border border-gray-300 rounded-lg px-3 py-2 text-base min-h-[44px]"
            maxlength="24"
            placeholder="Enter your name"
            required
            autocomplete="off"
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Avatar</label>
          <button
            type="button"
            class="w-full border border-gray-300 rounded-lg px-3 py-2 min-h-[44px] text-left flex items-center gap-3 bg-white hover:bg-gray-50 transition-colors"
            onclick={() => (showAvatarPicker = true)}
          >
            {#if avatarId}
              <img
                src="/api/avatars/{avatarId}/monogram.svg?name={encodeURIComponent(avatarDisplayName || avatarId)}"
                alt={avatarDisplayName || avatarId}
                class="w-9 h-9 rounded-full flex-shrink-0"
              />
              <span class="font-medium">{avatarDisplayName || avatarId}</span>
            {:else}
              <span class="w-9 h-9 rounded-full bg-gray-200 flex-shrink-0 inline-block"></span>
              <span class="text-gray-400">Tap to choose…</span>
            {/if}
          </button>
        </div>

        {#if error}
          <p class="text-red-600 text-sm font-medium" role="alert">{error}</p>
        {/if}

        <button
          type="submit"
          class="w-full bg-blue-600 text-white rounded-lg px-4 py-3 font-semibold text-base min-h-[44px] disabled:opacity-50 hover:bg-blue-700 transition-colors"
          disabled={!nickname.trim() || !avatarId || joining}
        >
          {joining ? "Joining…" : "Join quiz →"}
        </button>
      </form>

      <div class="border-t pt-4 space-y-2">
        <p class="text-xs text-gray-500 font-medium uppercase tracking-wide">Accessibility</p>
        <label class="flex items-center gap-3 min-h-[44px] cursor-pointer">
          <input
            type="checkbox"
            checked={largeText}
            onchange={toggleLargeText}
            class="w-5 h-5 rounded"
          />
          <span class="text-sm">Large text</span>
        </label>
        <label class="flex items-center gap-3 min-h-[44px] cursor-pointer">
          <input
            type="checkbox"
            checked={highContrast}
            onchange={toggleHighContrast}
            class="w-5 h-5 rounded"
          />
          <span class="text-sm">High contrast</span>
        </label>
      </div>
    </div>
  </main>
{/if}
