import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS_TAB,
  OBSERVED_SETTINGS_TABS,
  SETTINGS_TABS,
  resolveSettingsTab,
  settingsTabQuery,
} from "./settings-tabs-model";

describe("resolveSettingsTab", () => {
  it("已知 tab 原样返回", () => {
    expect(resolveSettingsTab("patrol", false)).toBe("patrol");
    expect(resolveSettingsTab("services", false)).toBe("services");
  });

  it("已删除的远程访问深链回落到默认页签", () => {
    expect(resolveSettingsTab("remote", {})).toBe("drives");
    expect(resolveSettingsTab("remote-access", {})).toBe("drives");
  });

  it("legacy 布尔第二参只表示「账号」tab 可见性，update 仍 fail-closed", () => {
    // 旧调用点传布尔即「账号可见」；它不该顺带把 update 也放开。
    expect(resolveSettingsTab("account", true)).toBe("account");
    expect(resolveSettingsTab("update", true)).toBe("drives");
  });

  it("两个受观察 tab 的可见性彼此独立", () => {
    expect(resolveSettingsTab("account", { account: true, update: false })).toBe("account");
    expect(resolveSettingsTab("update", { account: false, update: true })).toBe("update");
    expect(resolveSettingsTab("account", { account: false, update: true })).toBe("drives");
  });

  it("未知/缺失 → 默认 drives", () => {
    expect(resolveSettingsTab(null, false)).toBe(DEFAULT_SETTINGS_TAB);
    expect(resolveSettingsTab(undefined, false)).toBe("drives");
    expect(resolveSettingsTab("nonsense", false)).toBe("drives");
  });

  it("account 仅在账号 tab 可见时可达，否则回落默认", () => {
    expect(resolveSettingsTab("account", true)).toBe("account");
    expect(resolveSettingsTab("account", false)).toBe("drives");
  });

  it("legacy 锚点 hash 映射到 account（tab 参数缺失时）", () => {
    expect(resolveSettingsTab(null, true, "#password")).toBe("account");
    expect(resolveSettingsTab(null, true, "#accounts")).toBe("account");
    expect(resolveSettingsTab(null, false, "#password")).toBe("drives");
    // 显式 tab 参数优先于 hash
    expect(resolveSettingsTab("patrol", true, "#password")).toBe("patrol");
  });
});

describe("settingsTabQuery", () => {
  it("写 tab 且保留既有参数（w 工作区）", () => {
    expect(settingsTabQuery(new URLSearchParams("w=abc"), "patrol")).toBe("tab=patrol&w=abc");
  });
  it("默认 tab 时删掉 tab 参数保持 URL 干净", () => {
    expect(settingsTabQuery(new URLSearchParams("tab=patrol&w=abc"), "drives")).toBe("w=abc");
  });
});

describe("update tab", () => {
  it("is listed after 巡检与通知", () => {
    const ids = SETTINGS_TABS.map((tab) => tab.id);
    expect(ids.indexOf("update")).toBe(ids.indexOf("patrol") + 1);
  });
  it("is observed: a deep link falls back to drives until its slot renders", () => {
    expect(resolveSettingsTab("update", {})).toBe("drives");
    expect(resolveSettingsTab("update", { update: true })).toBe("update");
  });
});

describe("SETTINGS_TABS", () => {
  it("六个 tab、顺序与标签固定", () => {
    expect(SETTINGS_TABS.map((tab) => tab.id)).toEqual([
      "drives",
      "services",
      "preferences",
      "patrol",
      "update",
      "account",
    ]);
    expect(SETTINGS_TABS.map((tab) => tab.label)).toEqual([
      "网盘",
      "资源与服务",
      "获取偏好",
      "巡检与通知",
      "更新",
      "账号",
    ]);
  });

  it("受观察（内容为空即隐藏）的 tab 就是 account + update", () => {
    expect([...OBSERVED_SETTINGS_TABS]).toEqual(["account", "update"]);
  });
});
