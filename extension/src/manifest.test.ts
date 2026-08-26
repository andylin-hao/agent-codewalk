import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

interface ViewContainerContribution {
  readonly id: string;
  readonly title: string;
  readonly icon: string;
}

interface ExtensionManifest {
  readonly engines: {
    readonly vscode: string;
  };
  readonly contributes: {
    readonly viewsContainers: {
      readonly activitybar?: readonly ViewContainerContribution[];
      readonly secondarySidebar?: readonly ViewContainerContribution[];
    };
    readonly views: Readonly<Record<string, readonly { readonly id: string }[]>>;
  };
}

async function readManifest(): Promise<ExtensionManifest> {
  const value: unknown = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  return value as ExtensionManifest;
}

describe("workbench placement", () => {
  it("opens Agent CodeWalk from the right-side container switcher by default", async () => {
    const manifest = await readManifest();

    expect(manifest.engines.vscode).toBe("^1.106.0");
    expect(manifest.contributes.viewsContainers.activitybar).toBeUndefined();
    expect(manifest.contributes.viewsContainers.secondarySidebar).toEqual([
      {
        id: "agentCodeWalk",
        title: "%view.container.title%",
        icon: "media/icon.svg",
      },
    ]);
    expect(manifest.contributes.views.agentCodeWalk).toContainEqual(
      expect.objectContaining({ id: "agentCodeWalk.walkthrough" }),
    );
  });
});
