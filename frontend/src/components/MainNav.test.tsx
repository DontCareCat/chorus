// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MainNav } from "./MainNav";

afterEach(cleanup);

describe("MainNav", () => {
  it("lists the five places and marks the current one", () => {
    render(<MainNav variant="tabs" route="playlist" cards={0} />);
    const names = screen.getAllByRole("link").map((a) => a.textContent);
    expect(names).toEqual(["Home", "Playlists", "Dictionary", "Scores", "Settings"]);
    expect(screen.getByText("Playlists").closest("a")!.getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("Home").closest("a")!.getAttribute("aria-current")).toBeNull();
  });
  it("a song page and a review both belong to their section", () => {
    const { rerender } = render(<MainNav variant="rail" route="song" cards={0} />);
    expect(screen.getByText("Home").closest("a")!.getAttribute("aria-current")).toBe("page");
    rerender(<MainNav variant="rail" route="review" cards={0} />);
    expect(screen.getByText("Dictionary").closest("a")!.getAttribute("aria-current")).toBe("page");
  });
  it("shows the number of waiting cards on Dictionary", () => {
    render(<MainNav variant="tabs" route="library" cards={7} />);
    expect(screen.getByLabelText("7 cards to review").textContent).toBe("7");
  });
});
