export function shouldRequestTasksOnToggle(
  nextExpanded: boolean,
  tasksLoaded: boolean,
  tasksLoading: boolean,
): boolean {
  return nextExpanded && !tasksLoaded && !tasksLoading;
}
