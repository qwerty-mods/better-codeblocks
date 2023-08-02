import { components, plugins } from "replugged";
import { cfg } from ".";

import themes from "./themes/themes.json";
import Codeblock from "./Codeblock";

const { SelectItem } = components;

const previewData = `const btn = document.getElementById('btn')
let count = 0
function render() {
  btn.innerText = \`Count: \${count}\`
}
btn.addEventListener('click', () => {
  // Count from 1 to 10.
  if (count < 10) {
    count += 1
    render()
  }
})`;

export function Settings(): React.ReactElement {
  return (
    <>
      <Codeblock lang="js" code={previewData}></Codeblock>
      <br />
      <SelectItem
        options={themes.map((theme) => {
          return { label: theme, value: theme };
        })}
        onChange={(theme) => {
          cfg.set("theme", theme);

          const themeStylesheet = document.getElementById("hljs-theme") as HTMLLinkElement;
          if (themeStylesheet)
            themeStylesheet.href = `replugged://plugin/${
              plugins.plugins.get("dev.kingfish.BetterCodeblocks")!.path
            }/themes/${theme}.css`;
        }}
        isSelected={(theme) => cfg.get("theme") === theme}>
        Preferred Theme
      </SelectItem>
    </>
  );
}
