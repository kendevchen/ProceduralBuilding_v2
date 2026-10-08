/** Perspective framing shared by small and twenty-storey unfolded buildings. */
import { Box3, Vector3 } from 'three';

function basis(direction: Vector3) {
  const forward = direction.clone().normalize();
  const right = new Vector3(0, 1, 0).cross(forward).normalize();
  return { forward, right, up: forward.clone().cross(right) };
}
function corners(box: Box3): Vector3[] {
  return [box.min.x, box.max.x].flatMap(x => [box.min.y, box.max.y].flatMap(y =>
    [box.min.z, box.max.z].map(z => new Vector3(x, y, z))));
}
export function perspectiveBoxFits(box: Box3, position: Vector3, target: Vector3, fov: number, aspect: number): boolean {
  const { forward, right, up } = basis(position.clone().sub(target));
  const tanV = Math.tan(fov * Math.PI / 360) * .83, tanH = tanV * aspect;
  return corners(box).every(corner => {
    const p = corner.sub(position), depth = -p.dot(forward);
    return depth > 0 && Math.abs(p.dot(right)) <= depth * tanH && Math.abs(p.dot(up)) <= depth * tanV;
  });
}
export function fitPerspectiveBox(box: Box3, direction: Vector3, fov: number, aspect: number) {
  const target = box.getCenter(new Vector3()), { forward, right, up } = basis(direction);
  const tanV = Math.tan(fov * Math.PI / 360) * .83, tanH = tanV * aspect;
  let distance = 0;
  for (const corner of corners(box)) {
    const p = corner.sub(target), depth = p.dot(forward);
    distance = Math.max(distance, Math.abs(p.dot(right)) / tanH + depth, Math.abs(p.dot(up)) / tanV + depth);
  }
  // A tiny margin avoids boundary rounding in the projection after fitting.
  return { target, position: target.clone().addScaledVector(forward, distance * (1 + 1e-9)) };
}
