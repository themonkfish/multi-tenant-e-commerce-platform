import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CustomerOrderProgress } from "./customer-order-progress";

describe("CustomerOrderProgress", () => {
  it("marks the current delivery stage and completed stages accessibly", () => {
    const markup = renderToStaticMarkup(
      createElement(CustomerOrderProgress, { status: "Delivered" }),
    );

    expect(markup).toContain('aria-label="Order progress"');
    expect(markup).toContain('aria-current="step"');
    expect(markup).toContain(">Delivered</span>");
    expect(markup.match(/✓/g)).toHaveLength(3);
  });

  it("shows cancellation separately instead of advancing the delivery stages", () => {
    const markup = renderToStaticMarkup(
      createElement(CustomerOrderProgress, { status: "Cancelled" }),
    );

    expect(markup).toContain('role="status"');
    expect(markup).toContain("Order cancelled.");
    expect(markup).not.toContain('aria-label="Order progress"');
  });
});
