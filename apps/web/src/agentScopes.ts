import { ACTOR_IDS, type Actor } from './controlCenter';

export type AgentScopeRow = {
  resource: string;
  access: string;
};

export type AgentScopePreview = {
  actor: Actor;
  displayName: string;
  kind: 'user' | 'agent';
  note: string;
  purpose?: string;
  allowedTools?: string[];
  sensitivity: string;
  capabilities: string[];
  rights: AgentScopeRow[];
};

export const AGENT_SCOPE_PREVIEWS: AgentScopePreview[] = [
  {
    actor: 'owner',
    displayName: 'Sasha (owner)',
    kind: 'user',
    note: 'Полный доступ рабочей области по membership/owner, если нет явного deny.',
    sensitivity: 'Все уровни чувствительности рабочей области',
    capabilities: ['workspace.owner', 'connections.manage', 'memory.export'],
    rights: [
      { resource: 'Память', access: 'Чтение и запись' },
      { resource: 'Состояние проекта', access: 'Чтение и запись' },
      { resource: 'Хэнд-оффы', access: 'Чтение и запись' },
      { resource: 'Подключения', access: 'Управление и повторная авторизация' },
    ],
  },
  {
    actor: 'chatgpt',
    displayName: 'ChatGPT',
    kind: 'agent',
    note: 'Текущий билд показывает права из seed/demo ACL, отдельного live matrix API пока нет.',
    sensitivity: 'До internal',
    capabilities: ['memory.read', 'memory.write.decision', 'memory.write.summary'],
    rights: [
      { resource: 'Память проекта AISTROYKA', access: 'Чтение и запись' },
      { resource: 'Проект', access: 'Чтение' },
      { resource: 'Состояние проекта', access: 'Чтение' },
      { resource: 'Хэнд-оффы', access: 'Не показаны отдельным API' },
    ],
  },
  {
    actor: 'cursor',
    displayName: 'Cursor',
    kind: 'agent',
    note: 'Права на личную память не выдаются; доступ ограничен инженерным проектом.',
    sensitivity: 'До internal',
    capabilities: ['memory.read.project', 'session.write', 'handoff.write'],
    rights: [
      { resource: 'Память проекта AISTROYKA', access: 'Чтение' },
      { resource: 'Проект', access: 'Чтение' },
      { resource: 'Состояние проекта', access: 'Чтение и запись' },
      { resource: 'Хэнд-оффы и сессии', access: 'Чтение и запись' },
    ],
  },
  {
    actor: 'roma',
    displayName: 'ROMA',
    kind: 'agent',
    note: 'ROMA работает только по явно allowlisted проектам и не получает personal/mail/restricted без отдельного ACL.',
    purpose: 'Аудит, QA и findings по явно разрешенным проектам без наследования owner-прав.',
    allowedTools: [
      'memory.search',
      'memory.get',
      'context.project',
      'capture.text',
      'handoff.create',
      'memory.set_status',
    ],
    sensitivity: 'До internal',
    capabilities: ['memory.read.project', 'memory.write.findings', 'qa.read', 'handoff.write'],
    rights: [
      { resource: 'Память allowlisted проекта', access: 'Чтение и запись' },
      { resource: 'Состояние проекта', access: 'Чтение' },
      { resource: 'Хэнд-оффы', access: 'Чтение и запись' },
      { resource: 'Личные и почтовые данные', access: 'Нет доступа без явного ACL' },
    ],
  },
];

export function actorIdForPreview(actor: Actor): string {
  return ACTOR_IDS[actor];
}
