import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import MapView, { Polygon, Polyline, Marker, Circle } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { bearingDeg, yardsBetween } from '../../geo/distance';

// Coordinates are [lat, lng] everywhere else; converted only here.
const isPoint = (p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]);
const ll = (p) => ({ latitude: p[0], longitude: p[1] });
const polyLL = (poly) => (Array.isArray(poly) ? poly.filter(isPoint).map(ll) : []);
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const roundYds = (a, b) => {
  const y = yardsBetween(a, b);
  return y == null ? null : Math.round(y);
};

const STYLE = {
  green: { fill: 'rgba(144,238,144,0.35)', stroke: '#B7F0B1' },
  bunker: { fill: 'rgba(237,201,155,0.55)', stroke: '#EDC99B' },
  water: { fill: 'rgba(58,134,255,0.40)', stroke: '#7DB3FF' },
  ob: { fill: 'rgba(255,255,255,0.08)', stroke: '#FFFFFF' },
};

/** Camera that shows the whole hole with the tee at the bottom and the green at the top. */
export function holeCamera(hole, fallbackCenter) {
  const tee = isPoint(hole?.tee) ? hole.tee : null;
  const green = isPoint(hole?.green?.center) ? hole.green.center : null;
  if (tee && green) {
    const lengthYds = yardsBetween(tee, green) || 400;
    const lengthM = lengthYds * 0.9144;
    return {
      center: ll(mid(tee, green)),
      heading: bearingDeg(tee, green) || 0,
      pitch: 0,
      // Rough fit for a portrait map at ~55% of the screen; tune on device.
      altitude: Math.max(250, lengthM * 2.1 + 120),
      zoom: 17,
    };
  }
  const only = green || tee || (isPoint(fallbackCenter) ? fallbackCenter : null);
  if (only) {
    return { center: ll(only), heading: 0, pitch: 0, altitude: green || tee ? 450 : 1800, zoom: green || tee ? 17 : 15 };
  }
  return null;
}

// Static hole geometry. Memoized on the hole so GPS fixes don't redraw the polygons.
const HoleOverlays = memo(function HoleOverlays({ hole }) {
  const greenPoly = useMemo(() => polyLL(hole?.green?.polygon), [hole]);
  const hazards = useMemo(
    () => (hole?.hazards || [])
      .map((h) => ({ id: h.id, kind: h.kind, coords: polyLL(h.polygon) }))
      .filter((h) => h.coords.length >= 3),
    [hole],
  );
  const g = hole?.green || {};
  return (
    <>
      {hazards.map((h, i) => {
        const st = h.kind === 'bunker' ? STYLE.bunker : h.kind === 'ob' ? STYLE.ob : STYLE.water;
        return (
          <Polygon
            key={`hz-${h.id ?? i}`}
            coordinates={h.coords}
            fillColor={st.fill}
            strokeColor={st.stroke}
            strokeWidth={h.kind === 'ob' ? 2 : 1}
            lineDashPattern={h.kind === 'ob' ? [6, 4] : undefined}
            tappable={false}
          />
        );
      })}
      {greenPoly.length >= 3 && (
        <Polygon coordinates={greenPoly} fillColor={STYLE.green.fill} strokeColor={STYLE.green.stroke} strokeWidth={2} tappable={false} />
      )}
      {isPoint(hole?.tee) && (
        <Circle center={ll(hole.tee)} radius={3} fillColor="#FFFFFF" strokeColor="#2D6A4F" strokeWidth={2} />
      )}
      {isPoint(g.front) && <Circle center={ll(g.front)} radius={1.2} fillColor="#FFFFFF" strokeColor="#1B4332" strokeWidth={1} />}
      {isPoint(g.back) && <Circle center={ll(g.back)} radius={1.2} fillColor="#FFFFFF" strokeColor="#1B4332" strokeWidth={1} />}
      {isPoint(g.center) && (
        <Marker
          coordinate={ll(g.center)}
          pinColor="red"
          title={`Hole ${hole.hole_number}`}
          tracksViewChanges={false}
        />
      )}
    </>
  );
});

// Lines that move with the golfer / the tapped target.
const MeasureOverlays = memo(function MeasureOverlays({ origin, green, target }) {
  return (
    <>
      {origin && green && !target && (
        <Polyline coordinates={[ll(origin), ll(green)]} strokeColor="rgba(255,255,255,0.9)" strokeWidth={2} />
      )}
      {target && origin && (
        <Polyline coordinates={[ll(origin), ll(target)]} strokeColor="#FFD60A" strokeWidth={3} />
      )}
      {target && green && (
        <Polyline coordinates={[ll(target), ll(green)]} strokeColor="#FFD60A" strokeWidth={2} lineDashPattern={[8, 6]} />
      )}
      {target && <Marker coordinate={ll(target)} pinColor="yellow" tracksViewChanges={false} />}
    </>
  );
});

/**
 * Satellite map of one hole.
 * Props: hole (merged CourseHole), golfer ([lat,lng] when at the course, else null),
 * fallbackCenter ([lat,lng] course center), pinMode, pendingCenter, onPlaceGreen(point).
 * Tapping the map measures (golfer or tee -> point -> green); in pin mode a tap places the
 * green center instead.
 */
function HoleMapView({ hole, golfer, fallbackCenter, pinMode, pendingCenter, onPlaceGreen, style }) {
  const mapRef = useRef(null);
  const [target, setTarget] = useState(null);
  const holeKey = hole ? `${hole.loop_key || ''}|${hole.hole_number}` : 'none';
  const hasGreenGeom = isPoint(hole?.green?.center);
  const tee = isPoint(hole?.tee) ? hole.tee : null;

  const camera = useMemo(() => holeCamera(hole, fallbackCenter), [hole, fallbackCenter]);
  const initialCamera = useRef(camera).current;

  const recenter = useCallback(
    (animated = true) => {
      if (!camera || !mapRef.current) return;
      if (animated) mapRef.current.animateCamera(camera, { duration: 600 });
      else mapRef.current.setCamera(camera);
    },
    [camera],
  );

  // New hole: clear the measurement.
  useEffect(() => {
    setTarget(null);
  }, [holeKey]);

  // New hole, or its framing changed (course data arrived, green just set): frame the hole.
  const cameraKey = camera
    ? `${holeKey}|${camera.center.latitude.toFixed(5)},${camera.center.longitude.toFixed(5)}`
    : `${holeKey}|none`;
  useEffect(() => {
    recenter(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraKey]);

  const onPress = useCallback(
    (e) => {
      if (e?.nativeEvent?.action === 'marker-press') return;
      const c = e?.nativeEvent?.coordinate;
      if (!c) return;
      const p = [c.latitude, c.longitude];
      if (pinMode) onPlaceGreen?.(p);
      else setTarget(p);
    },
    [pinMode, onPlaceGreen],
  );

  const green = pinMode && pendingCenter ? pendingCenter : hasGreenGeom ? hole.green.center : null;
  const origin = golfer || tee;
  const toTarget = target && origin ? roundYds(origin, target) : null;
  const targetToGreen = target && green ? roundYds(target, green) : null;

  return (
    <View style={[s.wrap, style]}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        mapType="satellite"
        initialCamera={initialCamera || undefined}
        showsUserLocation
        showsMyLocationButton={false}
        showsCompass={false}
        showsPointsOfInterest={false}
        pitchEnabled={false}
        toolbarEnabled={false}
        onPress={onPress}
        onMapReady={() => recenter(false)}
      >
        <HoleOverlays hole={hole} />
        {!pinMode && <MeasureOverlays origin={origin} green={green} target={target} />}
        {pinMode && pendingCenter && <Marker coordinate={ll(pendingCenter)} pinColor="green" tracksViewChanges={false} />}
      </MapView>

      {pinMode && (
        <View style={s.pinBanner} pointerEvents="none">
          <Text style={s.pinBannerText}>Tap the middle of the green</Text>
        </View>
      )}

      {!pinMode && target && (
        <View style={s.measure}>
          <Text style={s.measureText}>
            {toTarget != null ? `${toTarget} to target` : 'Target'}
            {targetToGreen != null ? `  ·  ${targetToGreen} to green` : ''}
          </Text>
          <TouchableOpacity onPress={() => setTarget(null)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close-circle" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      )}

      <TouchableOpacity style={s.recenter} onPress={() => recenter(true)} accessibilityLabel="Re-center on hole">
        <Ionicons name="locate" size={22} color="#2D6A4F" />
      </TouchableOpacity>

      <View style={s.attribution} pointerEvents="none">
        <Text style={s.attributionText}>© OpenStreetMap contributors</Text>
      </View>
    </View>
  );
}

export default memo(HoleMapView);

const s = StyleSheet.create({
  wrap: { overflow: 'hidden', backgroundColor: '#1B4332' },
  recenter: {
    position: 'absolute', right: 12, top: 12, width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 4, elevation: 3,
  },
  measure: {
    position: 'absolute', left: 12, top: 12, right: 64, flexDirection: 'row', alignItems: 'center', gap: 8,
    alignSelf: 'flex-start', backgroundColor: 'rgba(27,67,50,0.88)', borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12,
  },
  measureText: { flex: 1, color: '#fff', fontSize: 15, fontWeight: '800' },
  pinBanner: {
    position: 'absolute', left: 12, right: 64, top: 12, backgroundColor: 'rgba(27,67,50,0.88)',
    borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12,
  },
  pinBannerText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  attribution: {
    position: 'absolute', left: 6, bottom: 28, backgroundColor: 'rgba(255,255,255,0.75)',
    borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1,
  },
  attributionText: { fontSize: 10, color: '#1B4332' },
});
