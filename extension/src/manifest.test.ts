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
  /**
   * Agent CodeWalk belongs beside the agent that produced the walkthrough, which VS Code
   * puts in the Secondary Side Bar. That bar is hidden until it is opened, and a hidden
   * bar has no container switcher, so an install that offered only that entry appeared to
   * have failed. Offering both keeps the walkthrough next to the agent without making the
   * Activity Bar the only place it can be found.
   */
  it("offers Agent CodeWalk from the Secondary Side Bar", async () => {
    const manifest = await readManifest();

    expect(manifest.engines.vscode).toBe("^1.106.0");
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

  it("offers it from the Activity Bar as well", async () => {
    const manifest = await readManifest();

    expect(manifest.contributes.viewsContainers.activitybar).toEqual([
      {
        id: "agentCodeWalkPrimary",
        title: "%view.container.title%",
        icon: "media/icon.svg",
      },
    ]);
    expect(manifest.contributes.views.agentCodeWalkPrimary).toContainEqual(
      expect.objectContaining({ id: "agentCodeWalk.walkthroughPrimary" }),
    );
  });
});
