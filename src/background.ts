import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { runCheck } from './checker';

export const STORE_CHECK_TASK = 'valorant-store-check';

// 백그라운드 태스크 정의는 모듈 최상위(전역)에서 해야 한다.
TaskManager.defineTask(STORE_CHECK_TASK, async () => {
  try {
    const run = await runCheck({ trigger: 'background' });
    return run.failed > 0 && run.ok === 0 ? BackgroundTask.BackgroundTaskResult.Failed : BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export interface BackgroundStatus {
  available: boolean;
  registered: boolean;
}

export async function getBackgroundStatus(): Promise<BackgroundStatus> {
  const status = await BackgroundTask.getStatusAsync();
  const registered = await TaskManager.isTaskRegisteredAsync(STORE_CHECK_TASK);
  return { available: status === BackgroundTask.BackgroundTaskStatus.Available, registered };
}

/** 가능하면 1시간 간격(OS 가 최종 결정)으로 상점 확인 태스크를 등록한다. */
export async function registerBackgroundCheck(): Promise<BackgroundStatus> {
  const status = await getBackgroundStatus();
  if (!status.available) return status;
  if (!status.registered) {
    await BackgroundTask.registerTaskAsync(STORE_CHECK_TASK, { minimumInterval: 60 });
  }
  return getBackgroundStatus();
}

export async function unregisterBackgroundCheck(): Promise<void> {
  if (await TaskManager.isTaskRegisteredAsync(STORE_CHECK_TASK)) {
    await BackgroundTask.unregisterTaskAsync(STORE_CHECK_TASK);
  }
}

/** 개발 빌드에서만 동작: 백그라운드 태스크를 즉시 실행해 본다. */
export async function triggerBackgroundForTesting(): Promise<boolean> {
  return BackgroundTask.triggerTaskWorkerForTestingAsync();
}
