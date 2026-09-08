<script setup lang="ts">
import { onMounted, ref } from "vue";

interface SourceListRecord {
  id: number;
  url: string;
  source_type: string;
  source_count: number;
  updated_at: string;
}

interface SourceListPage {
  items: SourceListRecord[];
  total: number;
  limit: number;
  offset: number;
}

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";
const sources = ref<SourceListRecord[]>([]);
const error = ref<string | null>(null);
const loading = ref(true);

onMounted(async () => {
  try {
    const response = await fetch(`${apiBaseUrl}/api/v1/sources`);
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    const page: SourceListPage = await response.json();
    sources.value = page.items;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <main>
    <h1>funread sources</h1>
    <p v-if="loading">Loading…</p>
    <p v-else-if="error">Failed to load sources: {{ error }}</p>
    <table v-else>
      <thead>
        <tr>
          <th>url</th>
          <th>source_type</th>
          <th>source_count</th>
          <th>updated_at</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="source in sources" :key="source.id">
          <td>{{ source.url }}</td>
          <td>{{ source.source_type }}</td>
          <td>{{ source.source_count }}</td>
          <td>{{ source.updated_at }}</td>
        </tr>
      </tbody>
    </table>
  </main>
</template>
