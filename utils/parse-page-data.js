async function structuredDataOfPage(page) {
  try {
    await page.waitForFunction("true", { timeout: 5000 });

    const bodyHtml = await page.$eval("body", (body) => body.innerHTML);
    console.log(bodyHtml);

    const structuredData = await page.evaluate(() => {
      const getData = (element) => {
        if (element && element.tagName) {
          if (
            ["SCRIPT", "STYLE", "NOSCRIPT", "SVG"].includes(
              element.tagName.toUpperCase(),
            )
          ) {
            return undefined;
          }
        } else {
          return undefined;
        }

        // Gather child data recursively
        let childData = Array.from(element.children)
          .map(getData)
          .filter((child) => child !== null);

        // Determine if text is relevant: no significant children or only BR children
        const isTextRelevant =
          childData.length === 0 ||
          childData.every((child) => child.tagName === "br");
        const textContent = isTextRelevant
          ? element.innerText.trim().split(/\s+/).slice(0, 12).join(" ")
          : undefined;

        // Build element data with additional attributes
        let data = {
          tagName: element.tagName.toLowerCase(),
          className: element.className || undefined,
          id: element.id || undefined,
          type: element.type || undefined,
          name: element.name || undefined,
          placeholder: element.placeholder || undefined,
          pattern: element.pattern || undefined,
          required: element.required || undefined,
          value: element.value || undefined,
          href:
            element.tagName.toLowerCase() === "a" ? element.href : undefined,
          options:
            element.tagName.toLowerCase() === "select"
              ? Array.from(element.options).map((option) => ({
                  value: option.value,
                  text: option.text,
                }))
              : undefined,
          text: textContent,
        };

        // Clean up data to remove undefined values
        Object.keys(data).forEach(
          (key) => data[key] === undefined && delete data[key],
        );

        // Flatten single-child structures and integrate attributes
        if (
          childData.length === 1 &&
          !data.className &&
          !data.id &&
          !data.text &&
          Object.keys(data).length === 1
        ) {
          data = childData[0]; // Flatten structure if parent is just a wrapper
        } else if (childData.length > 0) {
          data.children = childData;
        }

        return data;
      };
      console.log("---document.body", document.body);
      return getData(document.body);
    });

    return structuredData;
  } catch (err) {
    console.error("Error processing page data:", err);
    throw err;
  }
}

exports = { structuredDataOfPage };
