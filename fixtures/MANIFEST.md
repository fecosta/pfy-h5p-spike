# Fixture manifest

These are real PFY / Fala Gringo course exports. **The `.h5p` files are not
committed** — this repository is public and the content is copyrighted. The
manifest records exactly which packages the spike used so results stay
reproducible; `fixtures/copy-fixtures.sh` copies them out of the local corpus
(override the source with `PFY_H5P_CORPUS`).

| file | bytes | main library | lang | bundled libs | content assets | sha256 |
| --- | ---: | --- | --- | ---: | ---: | --- |
| `1-de-acordo-com-o-texto-e-possivel-afirmar-que-141.h5p` | 761,691 | `H5P.MultiChoice` | pt | 9 | 0 | `d47b2c520bb81acc…` |
| `4-encontre-no-texto-sinonimos-das-palavras-abaixo-124.h5p` | 754,051 | `H5P.Blanks` | pt | 10 | 0 | `47229bec49b40cda…` |
| `a-quais-perguntas-abaixo-o-texto-audio-responde-208.h5p` | 770,045 | `H5P.MultiChoice` | pt | 9 | 0 | `71c192f8d17c176c…` |
| `as-horas-em-portugues-196.h5p` | 1,093,611 | `H5P.DragQuestion` | pt | 17 | 1 | `161415cf95b80839…` |
| `conectores_funcoes_discursivas_documentation_tool.h5p` | 2,851 | `H5P.DocumentationTool` | pt-BR | 0 | 0 | `5452042d58a87940…` |
| `escute-e-repite-audio-207.h5p` | 1,753,987 | `H5P.ImageHotspots` | pt | 7 | 27 | `885b735451702de8…` |
| `quiz-question-set-7.h5p` | 3,211,370 | `H5P.QuestionSet` | pt | 22 | 6 | `faf330d2f93b698f…` |
| `verdadeiro-ou-falso-a-85.h5p` | 686,787 | `H5P.TrueFalse` | pt | 8 | 0 | `43ca2df64db305ff…` |

## Why these

- `1-de-acordo-com-o-texto-e-possivel-afirmar-que-141.h5p` — Multiple Choice — 2 of 4 correct with `singlePoint:false`, so maxScore is 2 rather than 1.
- `4-encontre-no-texto-sinonimos-das-palavras-abaixo-124.h5p` — Fill in the Blanks — free-text grading (`caseSensitive`, accent-sensitive).
- `a-quais-perguntas-abaixo-o-texto-audio-responde-208.h5p` — Carries HIGHER library patch levels — used to probe Lumi’s in-place patch upgrade behaviour.
- `as-horas-em-portugues-196.h5p` — Drag and Drop — deepest editor-dependency chain in the corpus (17 libraries incl. jQuery.ui).
- `conectores_funcoes_discursivas_documentation_tool.h5p` — Ships NO libraries at all (2,851 bytes); proves the Hub dependency-resolution path.
- `escute-e-repite-audio-207.h5p` — The only corpus package with BOTH image and audio: 26 hotspots each wrapping an H5P.Audio sub-content.
- `quiz-question-set-7.h5p` — The only package exercising aggregate multi-question scoring with an explicit `passPercentage` (50).
- `verdadeiro-ou-falso-a-85.h5p` — The most common type in the corpus (46/186 = 25%).
