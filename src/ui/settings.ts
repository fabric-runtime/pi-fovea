// Settings overlay for pi-fovea. Deliberately mirrors pi-fabric's
// settings component structure (SettingsList in a bordered Container,
// SelectList submenus, dotted-id coercion) so both extensions feel like one
// settings surface. Persistence: fovea.json under the pi agent dir, with a
// project override beneath pi's configured project resource directory; the
// external-editor keybinding switches the configuration layer being viewed and saved.

import { DynamicBorder, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { configDirName, resolveAgentDir } from "../core/agent-dir.js";
import {
  Container,
  type Component,
  type KeybindingsManager,
  SelectList,
  type SelectItem,
  type SelectListLayoutOptions,
  type SelectListTheme,
  SettingsList,
  type SettingItem,
  type SettingsListTheme,
  Spacer,
  Text,
} from "@earendil-works/pi-tui";
import {
  buildPartialFromId,
  loadFoveaConfig,
  loadFoveaConfigForScope,
  SYNC_MODES,
  SYNC_SCOPES,
  saveFoveaConfig,
  type FoveaConfig,
  type FoveaConfigScope,
} from "../core/config.js";

const BOOLEANS = ["true", "false"] as const;
const BUDGETS = [256, 512, 1024, 2048, 4096, 8192] as const;
const THRESHOLDS = [0.05, 0.1, 0.15, 0.25, 0.5, 1] as const;

const SELECT_LAYOUT: SelectListLayoutOptions = {
  minPrimaryColumnWidth: 12,
  maxPrimaryColumnWidth: 32,
};

type SettingsSubmenu = (currentValue: string, done: (selectedValue?: string) => void) => Component;

const settingsListTheme = (theme: Theme): SettingsListTheme => ({
  label: (text, selected) => (selected ? theme.fg("accent", text) : text),
  value: (text, selected) => (selected ? theme.fg("accent", text) : theme.fg("muted", text)),
  description: (text) => theme.fg("dim", text),
  cursor: theme.fg("accent", "→ "),
  hint: (text) => theme.fg("dim", text),
});

const selectListTheme = (theme: Theme): SelectListTheme => ({
  selectedPrefix: (text) => theme.fg("accent", text),
  selectedText: (text) => theme.fg("accent", text),
  description: (text) => theme.fg("muted", text),
  scrollInfo: (text) => theme.fg("muted", text),
  noMatch: (text) => theme.fg("muted", text),
});

class SelectSubmenu extends Container {
  readonly selectList: SelectList;

  constructor(
    theme: Theme,
    title: string,
    description: string | undefined,
    options: SelectItem[],
    currentValue: string,
    onSelect: (value: string) => void,
    onCancel: () => void,
  ) {
    super();
    this.addChild(new Text(theme.bold(theme.fg("accent", title)), 0, 0));
    if (description) {
      this.addChild(new Spacer(1));
      this.addChild(new Text(theme.fg("muted", description), 0, 0));
    }
    this.addChild(new Spacer(1));
    this.selectList = new SelectList(
      options,
      Math.min(options.length, 10),
      selectListTheme(theme),
      SELECT_LAYOUT,
    );
    const index = options.findIndex((option) => option.value === currentValue);
    if (index !== -1) this.selectList.setSelectedIndex(index);
    this.selectList.onSelect = (item) => onSelect(item.value);
    this.selectList.onCancel = onCancel;
    this.addChild(this.selectList);
    this.addChild(new Spacer(1));
    this.addChild(new Text(theme.fg("dim", "  Enter to select · Esc to go back"), 0, 0));
  }

  handleInput(data: string): void {
    this.selectList.handleInput(data);
  }
}

const numericSubmenu =
  (theme: Theme, values: readonly number[], title: string, description: string): SettingsSubmenu =>
  (currentValue, done) => {
    const options: SelectItem[] = values.map((v) => ({ value: String(v), label: String(v) }));
    if (!options.some((o) => o.value === currentValue)) {
      options.unshift({ value: currentValue, label: currentValue });
    }
    return new SelectSubmenu(
      theme,
      title,
      description,
      options,
      currentValue,
      (value) => done(value),
      () => done(),
    );
  };

const formatKey = (key: string): string =>
  key
    .split("+")
    .map((part) =>
      part === "ctrl"
        ? "Ctrl"
        : part === "alt"
          ? "Alt"
          : part === "shift"
            ? "Shift"
            : part.toUpperCase(),
    )
    .join("+");

export interface FoveaSettingsComponentOptions {
  keybindings?: Pick<KeybindingsManager, "matches" | "getKeys">;
  initialSaveScope?: FoveaConfigScope;
  projectScopeAvailable?: boolean;
  onSaveScopeChange?: (scope: FoveaConfigScope) => void;
  itemsForSaveScope?: (scope: FoveaConfigScope) => SettingItem[];
}

export class FoveaSettingsComponent extends Container {
  settingsList: SettingsList;
  private readonly theme: Theme;
  private readonly keybindings: Pick<KeybindingsManager, "matches" | "getKeys"> | undefined;
  private readonly saveScopeText: Text;
  private readonly settingsListContainer: Container;
  private readonly projectScopeAvailable: boolean;
  private readonly onChange: (id: string, newValue: string) => void;
  private readonly onCancel: () => void;
  private readonly onSaveScopeChange: (scope: FoveaConfigScope) => void;
  private readonly itemsForSaveScope: ((scope: FoveaConfigScope) => SettingItem[]) | undefined;
  private saveScope: FoveaConfigScope;

  constructor(
    theme: Theme,
    items: SettingItem[],
    onChange: (id: string, newValue: string) => void,
    onCancel: () => void,
    options: FoveaSettingsComponentOptions = {},
  ) {
    super();
    this.theme = theme;
    this.keybindings = options.keybindings;
    this.projectScopeAvailable = options.projectScopeAvailable ?? true;
    this.saveScope =
      options.initialSaveScope === "global" || !this.projectScopeAvailable ? "global" : "project";
    this.onChange = onChange;
    this.onCancel = onCancel;
    this.onSaveScopeChange = options.onSaveScopeChange ?? (() => {});
    this.itemsForSaveScope = options.itemsForSaveScope;
    this.addChild(new DynamicBorder((text) => theme.fg("border", text)));
    this.saveScopeText = new Text("", 1, 0);
    this.updateSaveScopeText();
    this.addChild(this.saveScopeText);
    this.addChild(new Spacer(1));
    this.settingsListContainer = new Container();
    this.settingsList = this.createSettingsList(items);
    this.settingsListContainer.addChild(this.settingsList);
    this.addChild(this.settingsListContainer);
    this.addChild(new DynamicBorder((text) => theme.fg("border", text)));
  }

  handleInput(data: string): void {
    if (this.keybindings?.matches(data, "app.editor.external")) {
      if (!this.projectScopeAvailable) return;
      this.saveScope = this.saveScope === "project" ? "global" : "project";
      this.updateSaveScopeText();
      this.onSaveScopeChange(this.saveScope);
      const nextItems = this.itemsForSaveScope?.(this.saveScope);
      if (nextItems) {
        this.settingsListContainer.clear();
        this.settingsList = this.createSettingsList(nextItems);
        this.settingsListContainer.addChild(this.settingsList);
      }
      return;
    }
    this.settingsList.handleInput(data);
  }

  override invalidate(): void {
    super.invalidate();
    this.updateSaveScopeText();
  }

  private createSettingsList(items: SettingItem[]): SettingsList {
    return new SettingsList(
      items,
      10,
      settingsListTheme(this.theme),
      this.onChange,
      this.onCancel,
      { enableSearch: true },
    );
  }

  private updateSaveScopeText(): void {
    const destination =
      this.saveScope === "project"
        ? `Project overrides (${configDirName}/fovea.json)`
        : `Global defaults (~/${configDirName}/agent/fovea.json)`;
    const keys = this.keybindings?.getKeys("app.editor.external") ?? [];
    const shortcut = keys.map(formatKey).join("/");
    const hint = !this.projectScopeAvailable
      ? " · project scope unavailable for untrusted projects"
      : !shortcut
        ? " · scope switch key unavailable"
        : this.saveScope === "global"
          ? ` · ${shortcut} switches scope · project overrides may remain active here`
          : ` · ${shortcut} switches scope`;
    this.saveScopeText.setText(
      this.theme.fg("muted", "Editing: ") +
        this.theme.fg("accent", destination) +
        this.theme.fg("dim", hint),
    );
  }
}

const setting = (
  id: string,
  label: string,
  currentValue: string,
  rest: { description?: string; values?: readonly string[]; submenu?: SettingsSubmenu } = {},
): SettingItem => {
  const item: SettingItem = { id, label, currentValue };
  if (rest.description !== undefined) item.description = rest.description;
  if (rest.values !== undefined) item.values = [...rest.values];
  if (rest.submenu !== undefined) item.submenu = rest.submenu;
  return item;
};

const coerceValue = (id: string, value: string, config: FoveaConfig): unknown => {
  const segments = id.split(".");
  let current: unknown = config;
  for (const s of segments) {
    if (typeof current !== "object" || current === null) return value;
    current = (current as Record<string, unknown>)[s];
  }
  if (typeof current === "boolean") return value === "true";
  if (typeof current === "number") {
    const n = Number(value);
    return Number.isFinite(n) ? n : current;
  }
  return value;
};

const buildItems = (theme: Theme, config: FoveaConfig): SettingItem[] => [
  setting("sync.mode", "Continuous sync", config.sync.mode, {
    description:
      "enabled shows sync messages; hidden delivers them to the model without rendering them in the transcript; disabled turns sync off. FOVEA_TURN_SYNC=off overrides.",
    values: SYNC_MODES,
  }),
  setting("sync.scope", "Sync attention", config.sync.scope, {
    description:
      "session steers only for top-level directories/files this conversation entered; repository restores root-wide steering. Index coverage remains root-wide in both modes.",
    values: SYNC_SCOPES,
  }),
  setting("sync.budget", "Sync budget", String(config.sync.budget), {
    description: "Max tokens for proactive repository steering sent to the model.",
    submenu: numericSubmenu(
      theme,
      BUDGETS,
      "Sync budget",
      "Max tokens for proactive repository steering.",
    ),
  }),
  setting("sync.ackClean", "Ack clean turns", config.sync.ackClean ? "true" : "false", {
    description:
      "Show a brief notification after changed-but-actionless turns. Default off; clean turns spend no model tokens.",
    values: BOOLEANS,
  }),
  setting("sync.steerThreshold", "Steer threshold", String(config.sync.steerThreshold), {
    description:
      "Total surprise (channel-weighted heat above the session's sync memory) that justifies steering the model. Higher means fewer continuations; route changes always steer.",
    submenu: numericSubmenu(
      theme,
      THRESHOLDS,
      "Steer threshold",
      "Surprise mass that steers the model.",
    ),
  }),
  setting("sync.pushFocus", "Push focus detail", config.sync.pushFocus ? "true" : "false", {
    description:
      "Embed a budgeted focus preview of the top drift target in red sync messages so no extra probe turn is needed. Off keeps the Next: advisory. Default on.",
    values: BOOLEANS,
  }),
  setting("tools.grepMode", "Grep integration", config.tools.grepMode, {
    description:
      "augment keeps native grep and appends a Fovea graph section to symbol-query results (default; also reaches pi.grep inside fabric_exec). replace installs the takeover where bare symbol queries navigate the graph only (legacy; changing it reloads extensions). off is native grep only.",
    values: ["augment", "replace", "off"],
  }),
  setting(
    "tools.grepAugmentBudget",
    "Grep augment budget",
    String(config.tools.grepAugmentBudget),
    {
      description: "Max tokens for the graph section appended to grep results in augment mode.",
      submenu: numericSubmenu(
        theme,
        BUDGETS,
        "Grep augment budget",
        "Max tokens for the appended Fovea graph section.",
      ),
    },
  ),
  setting("tools.defaultBudget", "Default tool budget", String(config.tools.defaultBudget), {
    description: "Token budget applied when a fovea_* tool call omits maxTokens.",
    submenu: numericSubmenu(
      theme,
      BUDGETS,
      "Default tool budget",
      "Fallback maxTokens for fovea tools.",
    ),
  }),
];

export interface FoveaSettingsDeps {
  /** Re-read config after a change (tool executors hold a per-root cache). */
  onConfigApplied?: () => void;
}

export interface FoveaSettingsResult {
  grepRegistrationChanged: boolean;
}

export const openFoveaSettings = async (
  context: ExtensionContext,
  deps: FoveaSettingsDeps = {},
): Promise<FoveaSettingsResult> => {
  if (context.mode !== "tui") {
    context.ui.notify("Fovea settings are available in TUI mode", "warning");
    return { grepRegistrationChanged: false };
  }
  const agentDir = resolveAgentDir();
  const scopes = {
    cwd: context.cwd,
    agentDir,
    projectTrusted: context.isProjectTrusted(),
  };
  let saveScope: FoveaConfigScope = scopes.projectTrusted ? "project" : "global";
  let config = loadFoveaConfigForScope(scopes, saveScope);
  const initialGrepRegistration = config.tools.grepMode === "replace";
  let dirty = false;

  const apply = (id: string, value: unknown): void => {
    try {
      saveFoveaConfig({ ...scopes, scope: saveScope }, buildPartialFromId(id, value));
    } catch (error) {
      context.ui.notify(
        `Failed to save Fovea settings: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
      return;
    }
    config = loadFoveaConfigForScope(scopes, saveScope);
    dirty = true;
    deps.onConfigApplied?.();
  };

  await context.ui.custom<void>((tui, theme, keybindings, done) => {
    const itemsForScope = (scope: FoveaConfigScope): SettingItem[] => {
      config = loadFoveaConfigForScope(scopes, scope);
      return buildItems(theme, config);
    };
    return new FoveaSettingsComponent(
      theme,
      itemsForScope(saveScope),
      (id, newValue) => apply(id, coerceValue(id, newValue, config)),
      () => done(),
      {
        keybindings,
        initialSaveScope: saveScope,
        projectScopeAvailable: scopes.projectTrusted,
        onSaveScopeChange: (scope) => {
          saveScope = scope;
          tui.requestRender();
        },
        itemsForSaveScope: itemsForScope,
      },
    );
  });

  if (dirty) context.ui.notify("Fovea settings saved.", "info");
  const effectiveConfig = loadFoveaConfig(scopes);
  return {
    grepRegistrationChanged:
      (effectiveConfig.tools.grepMode === "replace") !== initialGrepRegistration,
  };
};
