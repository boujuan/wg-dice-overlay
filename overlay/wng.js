/* Reglas Wrath & Glory — módulo puro (sin dependencias), testeable en node.
 * values: caras superiores de los dados, en orden de lanzamiento.
 * El ÚLTIMO dado es siempre el dado de Ira (dorado). */

export function iconsOf(v) {
  return v >= 6 ? 2 : v >= 4 ? 1 : 0;
}

export function rollTest(values, dn) {
  let icons = 0;
  for (const v of values) icons += iconsOf(v);
  const wrath = values[values.length - 1];
  const success = icons >= dn;
  const shifts = success ? Math.floor((icons - dn) / 2) : 0;
  return {
    icons, wrath, dn, success, shifts,
    complication: wrath === 1,
    glory: wrath === 6
  };
}

export function rollDamage(values, base) {
  let ed = 0;
  for (const v of values) ed += iconsOf(v);
  return { base, ed, total: base + ed, wrath: values[values.length - 1] };
}

export function rollFree(values) {
  return { total: values.reduce((a, b) => a + b, 0), wrath: values[values.length - 1] };
}

/* Veredicto + textos de banner (ES) */
export function describe(result, mode, label) {
  if (mode === 'test') {
    let cls = result.success ? 'success' : 'fail';
    let title = result.success ? 'ÉXITO' : 'FALLO';
    let detail = `${result.icons} icono${result.icons === 1 ? '' : 's'} vs DN ${result.dn}`;
    if (result.success && result.shifts > 0) {
      detail += ` · +${result.shifts} shift${result.shifts > 1 ? 's' : ''}`;
    }
    if (result.complication) {
      title = '¡COMPLICACIÓN!';
      cls = 'complication';
      detail += result.success ? ' · … y la Ira cobra su precio' : ' · la Ira traiciona';
    } else if (result.glory) {
      title = result.success ? '¡GLORIA!' : 'FALLO · ¡GLORIA!';
      cls = result.success ? 'glory' : 'fail';
      detail += ' · +1 Gloria para el grupo';
    }
    return { cls, title, detail };
  }
  if (mode === 'damage') {
    return {
      cls: 'damage',
      title: `DAÑO: ${result.total}`,
      detail: `${result.base} base + ${result.ed} de ${result.values.length} ED`
    };
  }
  return {
    cls: 'free',
    title: `TOTAL: ${result.total}`,
    detail: `${result.values.length} dados`
  };
}
