import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text, type KeybindingsManager, type SettingItem } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { FoveaSettingsComponent, openFoveaSettings } from "../src/ui/settings.js";

const keybindings = {
  matches: (data: string, keybinding: string) =>
    keybinding === "app.editor.external" && data === "\x07",
  getKeys: () => ["ctrl+g"],
} as unknown as Pick<KeybindingsManager, "matches" | "getKeys">;

describe("Fovea settings", () => {
  it("renders and persists the grep integration mode", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "pi-fovea-settings-"));
    const configPath = path.join(root, ".pi", "fovea.json");
    mkdirSync(path.dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify({ tools: { grepMode: "augment" } }));
    const notify = vi.fn();
    const theme = {
      fg: (_color: string, text: string) => text,
      bold: (text: string) => text,
    };
    const context = {
      mode: "tui",
      cwd: root,
      isProjectTrusted: () => true,
      ui: {
        notify,
        custom: async (factory: (...args: any[]) => any) =>
          new Promise<void>((resolve) => {
            const component = factory({ requestRender: () => {} }, theme, keybindings, () =>
              resolve(),
            );
            expect(component.render(100).join("\n")).toContain("Grep integration");
            for (let index = 0; index < 6; index++) component.handleInput("\u001b[B");
            component.handleInput("\r");
            component.handleInput("\u001b");
          }),
      },
    } as unknown as ExtensionContext;

    try {
      const result = await openFoveaSettings(context);
      expect(result).toEqual({ grepRegistrationChanged: true });
      expect(JSON.parse(readFileSync(configPath, "utf8"))).toMatchObject({
        tools: { grepMode: "replace" },
      });
      expect(notify).toHaveBeenCalledWith("Fovea settings saved.", "info");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("persists trusted-project changes globally after Ctrl+G", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "pi-fovea-settings-global-"));
    const cwd = path.join(root, "project");
    const agentDir = path.join(root, "agent");
    const inheritedAgentDir = process.env.PI_CODING_AGENT_DIR;
    mkdirSync(cwd, { recursive: true });
    process.env.PI_CODING_AGENT_DIR = agentDir;
    const theme = {
      fg: (_color: string, text: string) => text,
      bold: (text: string) => text,
    };
    const requestRender = vi.fn();
    const context = {
      mode: "tui",
      cwd,
      isProjectTrusted: () => true,
      ui: {
        notify: vi.fn(),
        custom: async (factory: (...args: any[]) => any) => {
          const component = factory({ requestRender }, theme, keybindings, () => {});
          component.handleInput("\x07");
          const list = component.settingsList as any;
          list.selectedIndex = list.items.findIndex(
            (item: { id: string }) => item.id === "sync.mode",
          );
          list.activateItem();
        },
      },
    } as unknown as ExtensionContext;

    try {
      const result = await openFoveaSettings(context);
      expect(result).toEqual({ grepRegistrationChanged: false });
      expect(requestRender).toHaveBeenCalledOnce();
      expect(JSON.parse(readFileSync(path.join(agentDir, "fovea.json"), "utf8"))).toMatchObject({
        sync: { mode: "hidden" },
      });
      expect(existsSync(path.join(cwd, ".pi", "fovea.json"))).toBe(false);
    } finally {
      if (inheritedAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = inheritedAgentDir;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps global edits visible when a project override remains effective", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "pi-fovea-settings-shadowed-global-"));
    const cwd = path.join(root, "project");
    const agentDir = path.join(root, "agent");
    const globalPath = path.join(agentDir, "fovea.json");
    const projectPath = path.join(cwd, ".pi", "fovea.json");
    const inheritedAgentDir = process.env.PI_CODING_AGENT_DIR;
    const inheritedTurnSync = process.env.FOVEA_TURN_SYNC;
    mkdirSync(path.dirname(globalPath), { recursive: true });
    mkdirSync(path.dirname(projectPath), { recursive: true });
    writeFileSync(globalPath, JSON.stringify({ tools: { grepMode: "augment" } }));
    writeFileSync(projectPath, JSON.stringify({ tools: { grepMode: "off" } }));
    process.env.PI_CODING_AGENT_DIR = agentDir;
    delete process.env.FOVEA_TURN_SYNC;
    const theme = {
      fg: (_color: string, text: string) => text,
      bold: (text: string) => text,
    };
    const requestRender = vi.fn();
    let globalLines: string[] = [];
    let projectLines: string[] = [];
    const context = {
      mode: "tui",
      cwd,
      isProjectTrusted: () => true,
      ui: {
        notify: vi.fn(),
        custom: async (factory: (...args: any[]) => any) => {
          const component = factory({ requestRender }, theme, keybindings, () => {});
          component.handleInput("\x07");
          expect(component.render(120).join("\n")).toContain(
            "project overrides may remain active here",
          );

          const globalList = component.settingsList as any;
          globalList.selectedIndex = globalList.items.findIndex(
            (item: { id: string }) => item.id === "tools.grepMode",
          );
          globalList.activateItem();
          globalLines = component.render(120);

          component.handleInput("\x07");
          projectLines = component.render(120);
        },
      },
    } as unknown as ExtensionContext;

    try {
      const result = await openFoveaSettings(context);
      expect(result).toEqual({ grepRegistrationChanged: false });
      expect(globalLines.find((line) => line.includes("Grep integration"))).toContain("replace");
      expect(projectLines.find((line) => line.includes("Grep integration"))).toContain("off");
      expect(JSON.parse(readFileSync(globalPath, "utf8"))).toMatchObject({
        tools: { grepMode: "replace" },
      });
      expect(JSON.parse(readFileSync(projectPath, "utf8"))).toMatchObject({
        tools: { grepMode: "off" },
      });
      expect(requestRender).toHaveBeenCalledTimes(2);
    } finally {
      if (inheritedAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = inheritedAgentDir;
      if (inheritedTurnSync === undefined) delete process.env.FOVEA_TURN_SYNC;
      else process.env.FOVEA_TURN_SYNC = inheritedTurnSync;
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("FoveaSettingsComponent save scope", () => {
  const theme = {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  } as never;

  const buildItems = (): SettingItem[] => [
    {
      id: "sync.mode",
      label: "Continuous sync",
      currentValue: "enabled",
      values: ["enabled", "hidden", "disabled"],
    },
    {
      id: "sync.budget",
      label: "Sync budget",
      currentValue: "1024",
      submenu: (_current, done) => {
        void done;
        return new Text("budget submenu", 0, 0);
      },
    },
  ];

  it("toggles save scope with Ctrl+G from the root and active submenus", () => {
    const scopes: string[] = [];
    const component = new FoveaSettingsComponent(
      theme,
      buildItems(),
      () => {},
      () => {},
      {
        keybindings,
        initialSaveScope: "project",
        projectScopeAvailable: true,
        onSaveScopeChange: (scope) => scopes.push(scope),
      },
    );

    expect(component.render(100).join("\n")).toContain(
      "Editing: Project overrides (.pi/fovea.json)",
    );

    component.handleInput("\x07");
    expect(component.render(100).join("\n")).toContain(
      "Editing: Global defaults (~/.pi/agent/fovea.json)",
    );

    const list = component.settingsList as any;
    list.selectedIndex = list.items.findIndex((item: { id: string }) => item.id === "sync.budget");
    list.activateItem();
    component.handleInput("\x07");

    expect(list.submenuComponent).not.toBeNull();
    expect(component.render(100).join("\n")).toContain(
      "Editing: Project overrides (.pi/fovea.json)",
    );
    expect(scopes).toEqual(["global", "project"]);
  });

  it("keeps untrusted projects global-only", () => {
    const onSaveScopeChange = vi.fn();
    const component = new FoveaSettingsComponent(
      theme,
      buildItems(),
      () => {},
      () => {},
      {
        keybindings,
        initialSaveScope: "global",
        projectScopeAvailable: false,
        onSaveScopeChange,
      },
    );

    component.handleInput("\x07");

    expect(component.render(100).join("\n")).toContain(
      "Editing: Global defaults (~/.pi/agent/fovea.json)",
    );
    expect(component.render(100).join("\n")).toContain("project scope unavailable");
    expect(onSaveScopeChange).not.toHaveBeenCalled();
  });
});
