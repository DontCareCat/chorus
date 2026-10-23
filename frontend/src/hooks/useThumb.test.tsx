// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { useThumb } from "./useThumb";

function Group() {
  const ref = useThumb();
  const [on, setOn] = useState(0);
  return (
    <div className="thumbs" ref={ref} data-testid="g">
      {["a", "b"].map((t, i) => <button key={t} aria-pressed={on === i} onClick={() => setOn(i)} ref={(b) => { if (b) Object.defineProperties(b, { offsetLeft: { value: i * 100, configurable: true }, offsetTop: { value: 0, configurable: true }, offsetWidth: { value: 90 + i * 10, configurable: true }, offsetHeight: { value: 30, configurable: true } }); }}>{t}</button>)}
    </div>
  );
}

describe("useThumb", () => {
  it("places the thumb on the chosen child and moves it when the choice changes", () => {
    const { getByTestId, getByText } = render(<Group />);
    const g = getByTestId("g");
    expect(g.style.getPropertyValue("--thumb-x")).toBe("0px");
    expect(g.style.getPropertyValue("--thumb-w")).toBe("90px");
    expect(g.dataset.thumb).toBe("still"); // the first placement does not glide
    act(() => { getByText("b").click(); });
    expect(g.style.getPropertyValue("--thumb-x")).toBe("100px");
    expect(g.style.getPropertyValue("--thumb-w")).toBe("100px");
  });
});
