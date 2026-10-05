import { basicSetup } from "codemirror";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { indentWithTab } from "@codemirror/commands";
import { HighlightStyle, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { python } from "@codemirror/lang-python";
import { tags } from "@lezer/highlight";

// Colors come from the design-system syntax tokens, so light and dark themes both apply.
const highlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword, tags.definitionKeyword, tags.moduleKeyword, tags.operatorKeyword, tags.bool, tags.null, tags.self], color: "var(--syntax-keyword)" },
  { tag: [tags.function(tags.variableName), tags.function(tags.definition(tags.variableName)), tags.definition(tags.className)], color: "var(--syntax-function)" },
  { tag: [tags.string, tags.special(tags.string)], color: "var(--syntax-string)" },
  { tag: [tags.number], color: "var(--syntax-function)" },
  { tag: [tags.comment], color: "var(--muted)", fontStyle: "italic" },
]);

const theme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "var(--recess)", color: "var(--text)", fontSize: "var(--text-code)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.7" },
  ".cm-content": { caretColor: "var(--text)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--text)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": { backgroundColor: "var(--accent-soft)" },
  ".cm-gutters": { backgroundColor: "var(--recess)", color: "var(--ink-3)", border: "none" },
  ".cm-activeLine": { backgroundColor: "var(--hover)" },
  ".cm-activeLineGutter": { backgroundColor: "var(--hover)", color: "var(--text)" },
  "&.cm-focused .cm-matchingBracket": { backgroundColor: "var(--accent-soft)", outline: "1px solid var(--accent)" },
  ".cm-tooltip, .cm-panels": { backgroundColor: "var(--raised)", color: "var(--text)", border: "1px solid var(--divider)" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "var(--accent-soft)", color: "var(--text)" },
});

// A VS Code-like Python editor: auto-indent, Tab/Shift-Tab, bracket matching, Ctrl+/.
// Escape, then Tab, moves focus out of the editor (CodeMirror's keyboard escape hatch).
export function createCodeEditor({ parent, doc, readOnly, label, onCursor }) {
  const report = (state) => {
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);
    onCursor?.(line.number, head - line.from + 1);
  };
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        basicSetup,
        keymap.of([indentWithTab]),
        python(),
        indentUnit.of("    "),
        EditorState.tabSize.of(4),
        theme,
        syntaxHighlighting(highlight),
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
        EditorView.contentAttributes.of({ id: "personal-code", "aria-label": label, ...(readOnly ? { "aria-disabled": "true" } : {}) }),
        EditorView.updateListener.of((update) => { if (update.selectionSet || update.docChanged) report(update.state); }),
      ],
    }),
  });
  report(view.state);
  return {
    get value() { return view.state.doc.toString(); },
    set value(text) { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } }); },
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
}
