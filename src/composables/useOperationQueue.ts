/**
 * 管理端并发操作队列（单资源互斥 + 全局并发上限）。
 *
 * 从 `SourcesView.vue` 拆出，降低页面体量并便于其他批量运维页复用。
 */
import { ref } from "vue";

export interface OperationTask {
  key: string;
  label: string;
  resourceId: number;
  resourceLabel: string;
  run: () => Promise<string | undefined>;
}

export function useOperationQueue(options: {
  concurrency?: number;
  onSuccess?: (task: OperationTask, detail?: string) => void;
  onError?: (task: OperationTask, reason: unknown) => void;
  onCancel?: (count: number) => void;
} = {}) {
  const concurrency = options.concurrency ?? 4;
  const queue: OperationTask[] = [];
  const pendingKeys = ref(new Set<string>());
  const activeResourceIds = new Set<number>();
  const queuedCount = ref(0);
  const runningCount = ref(0);

  function hasPending(key: string): boolean {
    return pendingKeys.value.has(key);
  }

  function enqueue(task: OperationTask): boolean {
    if (pendingKeys.value.has(task.key)) return false;
    queue.push(task);
    pendingKeys.value = new Set(pendingKeys.value).add(task.key);
    queuedCount.value = queue.length;
    drain();
    return true;
  }

  function drain(): void {
    while (runningCount.value < concurrency) {
      const index = queue.findIndex((task) => !activeResourceIds.has(task.resourceId));
      if (index < 0) return;
      const [task] = queue.splice(index, 1);
      if (!task) return;
      queuedCount.value = queue.length;
      runningCount.value += 1;
      activeResourceIds.add(task.resourceId);
      void execute(task);
    }
  }

  async function execute(task: OperationTask): Promise<void> {
    try {
      const detail = await task.run();
      options.onSuccess?.(task, detail);
    } catch (reason) {
      options.onError?.(task, reason);
    } finally {
      const next = new Set(pendingKeys.value);
      next.delete(task.key);
      pendingKeys.value = next;
      activeResourceIds.delete(task.resourceId);
      runningCount.value -= 1;
      drain();
    }
  }

  function cancelQueued(): void {
    const canceled = queue.splice(0);
    const next = new Set(pendingKeys.value);
    for (const task of canceled) next.delete(task.key);
    pendingKeys.value = next;
    queuedCount.value = 0;
    options.onCancel?.(canceled.length);
  }

  return {
    pendingKeys,
    queuedCount,
    runningCount,
    hasPending,
    enqueue,
    cancelQueued,
  };
}
