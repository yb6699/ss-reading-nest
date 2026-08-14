import { render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { Boot } from "./Boot.js";

describe("Boot", () => {
  it("shows a visible diagnostic while the app module is loading", () => {
    render(<Boot loadApp={() => new Promise(() => undefined)} />);

    expect(screen.getByText("阅读器加载诊断")).toBeInTheDocument();
    expect(screen.getByText("loading-app")).toBeInTheDocument();
  });

  it("loads the app module when boot succeeds", async () => {
    render(<Boot loadApp={async () => ({ App: () => <main>小窝首页</main> })} />);

    expect(await screen.findByText("小窝首页")).toBeInTheDocument();
  });

  it("shows sanitized diagnostics when the app module fails to load", async () => {
    Object.defineProperty(window, "openai", {
      configurable: true,
      value: {
        toolOutput: {
          sourceEndpointBase: "/source/secret-token",
          bookshelfSessions: [{ session: { id: "session-1" } }]
        },
        widgetState: { screen: "home" }
      }
    });

    render(
      <Boot
        loadApp={async () => {
          throw new Error(
            "failed /source/secret-token private/sources/source-id/source.txt data:image/png;base64,AQID"
          );
        }}
      />
    );

    expect(await screen.findByText("failed")).toBeInTheDocument();
    expect(screen.getByText("app-v82-native-inline")).toBeInTheDocument();
    expect(screen.getAllByText("present")).toHaveLength(3);
    expect(screen.getByText("1")).toBeInTheDocument();
    const diagnosticText = screen.getByRole("alert").textContent ?? "";
    expect(diagnosticText).toContain("/source/[redacted]");
    expect(diagnosticText).toContain("private/sources/[redacted]");
    expect(diagnosticText).toContain("data:image/[redacted]");
    expect(diagnosticText).not.toContain("secret-token");
    expect(diagnosticText).not.toContain("AQID");
  });

  it("shows diagnostics when the app render throws", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const BrokenApp = () => {
      throw new Error("render failed");
    };

    render(<Boot loadApp={async () => ({ App: BrokenApp })} />);

    await waitFor(() => {
      expect(screen.getByText("render failed")).toBeInTheDocument();
    });
    consoleError.mockRestore();
  });

  it("keeps a static startup fallback in html before React mounts", () => {
    const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const html = readFileSync(resolve(webRoot, "index.html"), "utf8");

    expect(html).toContain("data-startup-fallback");
    expect(html).toContain("app-v82-native-inline");
    expect(html).not.toContain("sourceText");
    expect(html).not.toContain("objectKey");
  });
});
