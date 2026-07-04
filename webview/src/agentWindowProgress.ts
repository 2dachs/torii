import type { AgentEvent } from './types';

interface AgentWindowProgressInput {
  loading: boolean;
  prompt: string;
  streamingText: string;
  events: AgentEvent[];
}

function progressSubject(prompt: string): string {
  const lower = prompt.toLowerCase();
  if (prompt.includes('コードレビュー') || lower.includes('review')) return 'コードレビュー';
  if (prompt.includes('セキュリティ') || lower.includes('security')) return 'セキュリティ';
  if (prompt.includes('UI') || prompt.includes('UX')) return 'UI/UX';
  if (prompt.includes('実装') || prompt.includes('修正')) return '実装内容';
  return '依頼内容';
}

function lastProgressEvent(events: AgentEvent[]): AgentEvent | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type === 'done' || event.type === 'error') continue;
    return event;
  }
  return null;
}

export function getAgentWindowProgressText(input: AgentWindowProgressInput): string | null {
  if (!input.loading) return null;
  if (input.streamingText.trim()) return '回答を組み立て中...';

  const event = lastProgressEvent(input.events);
  if (!event) return `${progressSubject(input.prompt)}について思考中...`;

  if (event.type === 'thinking_start') return `${progressSubject(input.prompt)}について思考中...`;
  if (event.type === 'context_warning') return 'コンテキストの問題があります';
  if (event.type === 'approval_required') return '承認が必要な操作があります';
  if (event.type === 'tool_use') {
    if (event.tool === 'read_file') return 'ファイルを確認中...';
    if (event.tool === 'grep' || event.tool === 'search_files' || event.tool === 'find_files') return '問題箇所を検索中...';
    if (event.tool === 'run_command') return '確認コマンドを実行中...';
    if (event.tool === 'attempt_completion') return '回答を組み立て中...';
    return `${event.tool}を実行中...`;
  }
  if (event.type === 'tool_result') {
    if (!event.ok) return `${event.tool}の問題があります`;
    return '結果を整理中...';
  }

  return `${progressSubject(input.prompt)}について思考中...`;
}
