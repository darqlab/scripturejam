<script lang="ts">
  let { connected, label = "Live" }: { connected: boolean; label?: string } = $props();
</script>

<span class="pill" class:is-offline={!connected}>
  <span class="dot"></span>{connected ? label : "Offline"}
</span>
