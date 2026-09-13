import { describe, expect, it } from 'vitest';

import { findUnsafeMarkup } from '../src/adapter/sanitize';

describe('findUnsafeMarkup', () => {
  it('finds a script tag anywhere in the params', () => {
    const findings = findUnsafeMarkup({
      question: "<p>ok</p><script>alert('x')</script>",
      answers: [{ text: '<div>a</div>' }]
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe('script-tag');
    expect(findings[0].path).toBe('question');
  });

  it('reports the exact path inside nested arrays', () => {
    const findings = findUnsafeMarkup({
      answers: [
        { text: '<div>fine</div>' },
        { text: '<img src=x onerror=alert(1)>' }
      ]
    });
    expect(findings.map((f) => f.path)).toEqual(['answers.1.text']);
    expect(findings[0].rule).toBe('inline-event-handler');
  });

  it('catches javascript: urls, iframes, srcdoc and data:text/html', () => {
    const rules = findUnsafeMarkup({
      a: '<a href="javascript:alert(1)">x</a>',
      b: '<iframe src="//evil"></iframe>',
      c: '<iframe srcdoc="&lt;script&gt;"></iframe>',
      d: '<object data="data:text/html;base64,PHNjcmlwdD4="></object>'
    }).map((f) => f.rule);

    expect(rules).toContain('javascript-url');
    expect(rules).toContain('iframe-tag');
    expect(rules).toContain('srcdoc-attribute');
    expect(rules).toContain('object-or-embed-tag');
  });

  it('does not flag the HTML that legitimate PFY content actually uses', () => {
    // Shapes taken from the real corpus: entity-encoded spaces, divs, emphasis,
    // lists, tables and file references.
    expect(
      findUnsafeMarkup({
        question: '<p>a.&nbsp;A farofa é uma receita criada pelos portugueses.</p>\n',
        answers: [
          { text: '<div>c.&nbsp;O Brasil recebe muitos turistas.</div>\n\n\n' },
          { text: '<div><strong>Certo</strong> — <em>veja</em> a tabela</div>' }
        ],
        media: { path: 'images/file-64bae82bcaa92.jpg', mime: 'image/jpeg' },
        html: '<table><tr><td>x</td></tr></table><ul><li>y</li></ul>'
      })
    ).toEqual([]);
  });

  it('does not flag prose that merely mentions the dangerous words', () => {
    // The event-handler and javascript: rules only match inside a tag, so a
    // Portuguese lesson about JavaScript is not a security finding.
    expect(
      findUnsafeMarkup({
        question: '<p>O atributo onload executa javascript: quando a página carrega.</p>',
        answers: [{ text: '<div>onerror é um manipulador de eventos</div>' }]
      })
    ).toEqual([]);
  });

  it('walks strings regardless of nesting depth', () => {
    const findings = findUnsafeMarkup({
      questions: [
        { params: { subContent: { deep: [{ text: '<script>x</script>' }] } } }
      ]
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('questions.0.params.subContent.deep.0.text');
  });

  it('tolerates params that are not objects', () => {
    expect(findUnsafeMarkup(null)).toEqual([]);
    expect(findUnsafeMarkup(undefined)).toEqual([]);
    expect(findUnsafeMarkup(42)).toEqual([]);
    expect(findUnsafeMarkup('<script>x</script>')).toHaveLength(1);
  });
});
