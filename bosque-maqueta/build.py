# Genera index.html incrustando compo.strudel dentro de <strudel-editor> y de <script id="compo">
import pathlib
root = pathlib.Path(__file__).parent
code = (root / 'compo.strudel').read_text()
assert '-->' not in code and '</script' not in code.lower()
html = (root / 'template.html').read_text().replace('{{CODE}}', code)
(root / 'index.html').write_text(html)
print('index.html ok')
