import com.threerings.piracy.puzzle.crafting.weave.data.WeaveBoard;
import com.threerings.piracy.puzzle.crafting.weave.data.b;
import com.threerings.piracy.puzzle.crafting.weave.data.q;
import java.util.*;

/** Export deterministic reference boards and resolved chains for the Weaving regression suite. */
public class WeavingParity {
  static class Observer extends q {
    b result;
    public void u(b value) { result = value; }
  }
  static String grid(WeaveBoard board) {
    StringJoiner rows = new StringJoiner(",", "[", "]");
    for (int row = 0; row < 11; row++) rows.add(Arrays.toString(board.getRow(row)).replace(" ", ""));
    return rows.toString();
  }
  public static void main(String[] args) throws Exception {
    StringJoiner games = new StringJoiner(",", "[", "]");
    for (int difficulty = 0; difficulty <= 8; difficulty++) for (long seed : new long[]{0,1,42,123456789,-7,281474976710655L}) {
      WeaveBoard board = new WeaveBoard(difficulty);
      board.initializeSeed(seed);
      Random moves = new Random(seed + 99);
      String start = grid(board);
      StringJoiner steps = new StringJoiner(",", "[", "]");
      for (int step = 0; step < 100; step++) {
        List<Integer> legal = new ArrayList<>();
        for (int offset = 0; offset <= board.getMaxOffset(); offset++) if (board.isBattenableOffset(offset)) legal.add(offset);
        if (legal.isEmpty()) break;
        int offset = legal.get(moves.nextInt(legal.size()));
        Observer observer = new Observer();
        board.batten(offset, observer);
        b result = observer.result;
        StringJoiner stages = new StringJoiner(",", "[", "]");
        for (Object stage : (List<?>)b.class.getField("u").get(result)) {
          Object reed = stage.getClass().getField("left").get(stage);
          Object groups = stage.getClass().getField("right").get(stage);
          List<String> groupStrings = new ArrayList<>();
          if (groups != null) for (Object group : (Set<?>)groups) {
            List<String> cells = new ArrayList<>();
            for (Object cell : (Set<?>)group) cells.add("[" + cell.getClass().getField("left").get(cell) + "," + cell.getClass().getField("right").get(cell) + "]");
            Collections.sort(cells);
            groupStrings.add("{\"colour\":" + group.getClass().getField("type").get(group) + ",\"cells\":[" + String.join(",",cells) + "]}");
          }
          Collections.sort(groupStrings);
          stages.add("{\"reed\":"+reed+",\"groups\":["+String.join(",",groupStrings)+"]}");
        }
        boolean complete = board.getGroupsCleared() >= board.getGroupsToComplete();
        boolean booched = b.class.getField("q").getBoolean(result);
        steps.add("{\"offset\":"+offset+",\"board\":"+grid(board)+",\"groups\":"+board.getGroupsCleared()+",\"complete\":"+complete+",\"booched\":"+booched+",\"stages\":"+stages+"}");
        if (complete || booched) break;
      }
      games.add("{\"difficulty\":"+difficulty+",\"seed\":\""+seed+"\",\"start\":"+start+",\"steps\":"+steps+"}");
    }
    System.out.println(games);
  }
}
