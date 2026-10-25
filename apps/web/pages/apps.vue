<script setup lang="ts">
import { appsBaseUrl } from "~/lib/live-apps";

// The team's wallet server: NUXT_PUBLIC_APPS_URL, or the default host when it is empty.
const appsUrl = appsBaseUrl(useRuntimeConfig().public.appsUrl);
</script>

<template><AppsScreen :apps-url="appsUrl" /></template>
