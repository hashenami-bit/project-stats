"""Builds app/index.html from app/src.html plus the CSS of the artifact page (one design, two places)."""
import pathlib, re
here = pathlib.Path(__file__).parent
art = (here.parent / 'project-stats.html').read_text(encoding='utf-8')
css = re.search(r'<style>(.*?)</style>', art, re.S).group(1)
src = (here / 'src.html').read_text(encoding='utf-8')
(here / 'index.html').write_text(src.replace('/*__BASE_CSS__*/', css), encoding='utf-8')
print('built index.html')
