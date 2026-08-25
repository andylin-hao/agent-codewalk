import { beforeEach, describe, expect, it } from "vitest";
import * as vscode from "vscode";

import { StepCodeLensProvider } from "./codelens.js";
import type { LocatedStep, WalkthroughPlayer } from "./player.js";
import type { ViewState } from "./types.js";
import { buildStep, hashBlock } from "./test/fixtures.js";
import { documentFromText, resetVscodeMock } from "./test/vscode-mock.js";

interface PlayerStub {
  located: LocatedStep[];
  readonly player: WalkthroughPlayer;
  fireState: () => void;
}

function createPlayerStub(located: LocatedStep[]): PlayerStub {
  const emitter = new vscode.EventEmitter<ViewState>();
  const stub = {
    located,
    locateSteps: () => stub.located,
    onDidChangeState: emitter.event,
  };
  return {
    get located() {
      return stub.located;
    },
    set located(value: LocatedStep[]) {
      stub.located = value;
    },
    player: stub as unknown as WalkthroughPlayer,
    fireState: () => {
      emitter.fire({} as ViewState);
    },
  };
}

const located: LocatedStep[] = [
  {
    step: buildStep({
      id: "ready",
      path: "src/lib.rs",
      startLine: 1,
      endLine: 2,
      text: "fn ready() {}",
      title: "Expose readiness",
      previousText: "fn old() {}",
    }),
    position: 1,
    startLine: 4,
    endLine: 5,
    active: true,
  },
  {
    step: buildStep({
      id: "later",
      path: "src/lib.rs",
      startLine: 8,
      endLine: 8,
      text: "fn later() {}",
      title: "Add a follow-up",
    }),
    position: 2,
    startLine: 8,
    endLine: 8,
    active: false,
  },
];

beforeEach(() => {
  resetVscodeMock();
});

describe("StepCodeLensProvider", () => {
  it("puts one lens on each explained block and a diff lens where one is possible", () => {
    const stub = createPlayerStub(located);
    const provider = new StepCodeLensProvider(stub.player);
    const document = documentFromText("/workspace/src/lib.rs", "one\ntwo\nthree\n");

    const lenses = provider.provideCodeLenses(document as never);
    expect(lenses.map((lens) => lens.command?.title)).toEqual([
      "● Step 1 · Expose readiness",
      "Compare with before",
      "○ Step 2 · Add a follow-up",
    ]);
    expect(lenses[0]?.range.start.line).toBe(3);
    expect(lenses[0]?.command?.command).toBe("agentCodeWalk.goToStep");
    expect(lenses[0]?.command?.arguments).toEqual(["ready"]);
    expect(lenses[1]?.command?.command).toBe("agentCodeWalk.showStepDiff");
    provider.dispose();
  });

  it("ignores documents that are not files on disk", () => {
    const stub = createPlayerStub(located);
    const provider = new StepCodeLensProvider(stub.player);
    const document = {
      uri: vscode.Uri.parse("agent-codewalk:/before/x/lib.rs"),
      getText: () => "",
    };

    expect(provider.provideCodeLenses(document as never)).toEqual([]);
    provider.dispose();
  });

  it("asks the editor to redraw when the walkthrough moves", () => {
    const stub = createPlayerStub(located);
    const provider = new StepCodeLensProvider(stub.player);
    let redraws = 0;
    provider.onDidChangeCodeLenses(() => {
      redraws += 1;
    });

    stub.fireState();
    expect(redraws).toBe(1);
    provider.dispose();
  });

  it("renders nothing when no step points into the document", () => {
    const stub = createPlayerStub([]);
    const provider = new StepCodeLensProvider(stub.player);
    const document = documentFromText("/workspace/src/other.rs", "code\n");
    expect(provider.provideCodeLenses(document as never)).toEqual([]);
    expect(hashBlock("code")).toHaveLength(64);
    provider.dispose();
  });
});
