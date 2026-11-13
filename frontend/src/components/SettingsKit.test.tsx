// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useSectionSpy } from "./SettingsKit";

afterEach(cleanup);

function Probe({ ids }: { ids: string[] }) {
  const [current] = useSectionSpy(ids);
  return <output>{current}</output>;
}

describe("useSectionSpy", () => {
  it("a page that is not scrolled has its first section current, even while its cards are not drawn yet", () => {
    render(<Probe ids={["appearance", "lyrics", "about"]} />);
    expect(screen.getByRole("status").textContent).toBe("appearance");
  });
  it("is still the first after the page grows without scrolling", async () => {
    render(<Probe ids={["appearance", "lyrics", "about"]} />);
    await act(async () => { window.dispatchEvent(new Event("resize")); });
    expect(screen.getByRole("status").textContent).toBe("appearance");
  });
});
