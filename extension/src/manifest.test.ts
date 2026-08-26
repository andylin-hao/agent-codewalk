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
   * puts in the Secondary Side Bar. That bar is hidden until it is opened, so the icon is
   * only findable once it is, and the documentation has to say so rather than describing
   * a switcher a new reader cannot see. Moving the container to the Activity Bar would
   * make it findable and put it away from the agents, which is the wrong trade.
   */
  it("puts Agent CodeWalk beside the agents in the Secondary Side Bar", async () => {
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
