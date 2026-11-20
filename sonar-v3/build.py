# Genera index.html incrustando compo.strudel dentro de <strudel-editor>
import pathlib
root = pathlib.Path(__file__).parent
code = (root / 'compo.strudel').read_text()
assert '-->' not in code
html = (root / 'template.html').read_text().replace('{{CODE}}', code)
(root / 'index.html').write_text(html)
print('index.html ok')
