<script lang="ts">
  import { page } from "$app/stores";

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

<div class="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6">
  <div class="max-w-sm w-full bg-white rounded-2xl shadow-md p-6 space-y-6 text-center">
    <div>
      <h1 class="text-2xl font-bold text-gray-900">scripturejam</h1>
      <p class="text-gray-500 text-sm mt-1">Results</p>
    </div>

    <div class="bg-gray-100 rounded-xl p-4 space-y-1">
      <p class="text-xs text-gray-400 uppercase tracking-wide">Session code</p>
      <p class="text-4xl font-black font-mono tracking-widest text-gray-800">{code}</p>
    </div>

    <div class="space-y-2">
      <img
        src="/api/sessions/{code}/qr.svg"
        alt="QR code for session {code}"
        class="w-40 h-40 mx-auto rounded-xl bg-white p-1 border"
      />
      <p class="text-sm text-gray-500">Scan to join or view this session</p>
    </div>

    <div class="space-y-3 text-sm text-gray-600">
      <p>
        Results for this session are available to participants who completed the quiz.
        The host can share the link below.
      </p>
    </div>

    <div class="flex items-center gap-2">
      <code class="flex-1 text-xs text-blue-600 bg-blue-50 rounded-lg px-3 py-2 truncate text-left">
        {typeof window !== "undefined" ? window.location.href : `/r/${code}`}
      </code>
      <button
        type="button"
        onclick={copyLink}
        class="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium min-h-[44px] min-w-[44px] transition-colors"
      >
        {copyDone ? "✓" : "Copy"}
      </button>
    </div>

    <a
      href="/j/{code}"
      class="block w-full py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl min-h-[44px] transition-colors"
    >
      Join this session
    </a>
  </div>
</div>
