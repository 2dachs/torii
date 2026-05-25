import * as fs from 'fs';
import * as path from 'path';

export interface PettalRoutingRule {
  keyword: string;
  targetProvider: string;
  targetModel: string;
  reason: string;
}

export interface PettalModelLimit {
  modelId: string;
  maxCallsPerMonth?: number;
  maxCostUsdPerMonth?: number;
}

export interface PettalProjectConfig {
  version: number;
  provider?: string;
  model?: string;
  mainProvider?: string;
  mainModel?: string;
  subProvider?: string;
  subModel?: string;
  autoRouting?: boolean;
  routingRules?: PettalRoutingRule[];
  modelLimits?: PettalModelLimit[];
}

const PETTAL_FILE_NAME = '.pettal';

export function loadPettalConfig(workspaceRoot: string): PettalProjectConfig | null {
  if (!workspaceRoot) return null;
  const filePath = path.join(workspaceRoot, PETTAL_FILE_NAME);
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as PettalProjectConfig;
  } catch {
    return null;
  }
}

export function savePettalConfig(workspaceRoot: string, config: PettalProjectConfig): void {
  const filePath = path.join(workspaceRoot, PETTAL_FILE_NAME);
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
}
