package com.threerings.piracy.puzzle.duty.carpentry;

import java.awt.Canvas;
import java.awt.Point;
import java.awt.event.ActionEvent;
import java.awt.event.MouseEvent;
import java.lang.reflect.Field;
import sun.misc.Unsafe;

/** Executes the installed client's mouse listener and action dispatcher without a logged-in UI.
 * Rendering/movement and the final placement callback are observed rather than sent to a server.
 */
public class CarpentryInputProbe {
  static class Controller extends CarpentryController {
    int placements;
    boolean mousePlacement;
    @Override protected boolean p() { return false; }
    @Override protected void f(int dx, int dy) {}
    @Override protected void b(boolean mouse) { placements++; mousePlacement = mouse; }
    boolean held() { return j != null; }
    void tentative(r sprite) { q = sprite; c = 0; p = new Point(5, 5); a = new Point(5, 5); }
  }
  static class Sprite extends r {
    Sprite() { super(new p()); i.setBounds(100, 100, 55, 55); }
    @Override public void f(boolean held) { b = held; }
  }
  static class Mouse extends z {
    Mouse(Controller controller) { super(controller); }
    // Leave pixel-to-grid conversion/rendering out; the client's drag recognition still runs.
    @Override public void mouseMoved(MouseEvent event) {}
  }
  static final Canvas CANVAS = new Canvas();
  static Controller controller() throws Exception {
    Field field = Unsafe.class.getDeclaredField("theUnsafe"); field.setAccessible(true);
    Controller c = (Controller)((Unsafe)field.get(null)).allocateInstance(Controller.class);
    c.tentative(new Sprite());
    return c;
  }
  static MouseEvent event(int id, int x, int y, long when, int button) {
    return new MouseEvent(CANVAS, id, when, 0, x, y, 1, false, button);
  }
  static void drag(int distance, long elapsed) throws Exception {
    Controller c = controller(); Mouse mouse = new Mouse(c);
    mouse.mousePressed(event(MouseEvent.MOUSE_PRESSED, 127, 127, 1000, 1));
    mouse.mouseDragged(event(MouseEvent.MOUSE_DRAGGED, 127 + distance, 127, 1000 + elapsed, 0));
    mouse.mouseReleased(event(MouseEvent.MOUSE_RELEASED, 127 + distance, 127, 1001 + elapsed, 1));
    System.out.println("{\"case\":\"drag\",\"distance\":" + distance + ",\"elapsedMs\":" + elapsed + ",\"placementCallbacks\":" + c.placements + "}");
  }
  public static void main(String[] args) throws Exception {
    Controller c = controller(); Mouse mouse = new Mouse(c);
    mouse.mousePressed(event(MouseEvent.MOUSE_PRESSED, 127, 127, 1000, 1));
    mouse.mouseReleased(event(MouseEvent.MOUSE_RELEASED, 127, 127, 1001, 1));
    mouse.mouseMoved(event(MouseEvent.MOUSE_MOVED, 200, 127, 1002, 0));
    System.out.println("{\"case\":\"click-release-move\",\"held\":" + c.held() + ",\"placementCallbacks\":" + c.placements + "}");
    for (int d : new int[]{14, 15, 16, 18}) for (long t : new long[]{1, 100, 1000}) drag(d, t);
    c = controller(); mouse = new Mouse(c);
    // Native sprite hit-testing uses its bounding rectangle, including blank corners.
    mouse.mousePressed(event(MouseEvent.MOUSE_PRESSED, 100, 100, 1000, 1));
    System.out.println("{\"case\":\"bounding-corner\",\"held\":" + c.held() + "}");
    c = controller();
    c.x(new ActionEvent(CANVAS, ActionEvent.ACTION_PERFORMED, "place"));
    System.out.println("{\"case\":\"place-key\",\"mousePickupPath\":" + c.held() + ",\"placementCallbacks\":" + c.placements + ",\"mousePlacement\":" + c.mousePlacement + "}");
  }
}
