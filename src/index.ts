import { Injector, Logger, common, components } from "replugged";
import Codeblock from "./Codeblock";

const { parser, React } = common;
const { ErrorBoundary } = components;

import "./index.css";

const injector = new Injector();

export function start(): void {
  injector.after(parser.defaultRules.codeBlock, "react", (args, _) => {
    const { lang, content: code } = args[0] as { lang: string; content: string };

    return React.createElement(
      ErrorBoundary,
      {},
      React.createElement(Codeblock, {
        lang,
        code,
      }),
    );
  });
}

export function stop(): void {
  injector.uninjectAll();
}
