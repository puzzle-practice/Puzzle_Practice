// Test build 20261024072802. Uses the game's own board, matcher, scorer and wild helper.
// javac -cp <code jar> -d <output> NavigationTestParity.java
// java -cp <code jar>;<output> NavigationTestParity > navigation-test-parity.json
import com.threerings.piracy.puzzle.duty.navi.RingBoard;
import com.threerings.piracy.puzzle.duty.navi.f;
import java.lang.reflect.*;
import java.util.*;

public class NavigationTestParity {
  static Class<?> scorerClass, wildClass;
  static Object matcher;
  static Method match, reset, scoreStep, total, targetCheck, targetClear, wildRuns, wildAction, wildCompleted, wildNext;
  static Object scorer() throws Exception { Object s=scorerClass.getConstructor().newInstance();reset.invoke(s);return s; }
  static void init() throws Exception {
    scorerClass=Class.forName("com.threerings.piracy.puzzle.duty.navi.k.a");
    wildClass=Class.forName("com.threerings.piracy.puzzle.duty.navi.k.n");
    Class<?> m=Class.forName("com.threerings.piracy.puzzle.duty.navi.k.t");
    matcher=m.getConstructor().newInstance(); match=m.getMethod("k",RingBoard.class,scorerClass);
    reset=scorerClass.getMethod("k");scoreStep=scorerClass.getMethod("t");total=scorerClass.getMethod("r");
    Class<?> t=Class.forName("com.threerings.piracy.puzzle.duty.navi.k.k");
    targetCheck=t.getMethod("k",RingBoard.class,f.class);targetClear=t.getMethod("k",RingBoard.class,f.class,scorerClass);
    wildRuns=wildClass.getMethod("k",List.class,f.class);wildAction=wildClass.getMethod("t");
    wildCompleted=wildClass.getMethod("k",f.class);wildNext=wildClass.getMethod("t",f.class);
  }
  static String targets(f t) { StringJoiner j=new StringJoiner(",","[","]");for(int i=0;i<t.k();i++) j.add("["+t.t(i)+","+t.b(i)+","+t.k(i)+","+t.r(i)+"]");return j.toString(); }
  static String cells(RingBoard b) { StringJoiner j=new StringJoiner(",","[","]");for(int ring=0;ring<b.getRingCount();ring++)for(int o=0;o<8;o++)j.add(""+b.getPiece(o,ring));return j.toString(); }
  static String runs(List<?> runs) throws Exception { StringJoiner j=new StringJoiner(",","[","]");for(Object run:runs){Class<?> c=run.getClass();j.add("["+c.getField("b").get(run)+","+c.getField("r").get(run)+","+c.getField("x").get(run)+","+c.getField("a").get(run)+"]");}return j.toString(); }
  public static void main(String[] args) throws Exception {
    init();StringJoiner cases=new StringJoiner(",","[","]");
    // Werewolf Isle deals dense constellations: 1/2/1 on the opening chart, then 3/2/1, innermost first.
    for(boolean dense:new boolean[]{false,true})for(int rings:new int[]{3,4})for(int d:new int[]{0,4,9})for(long seed:new long[]{1,42,8675309}) {
      RingBoard b=new RingBoard(rings,d);b.setDenseConstellations(dense);b.initializeSeed(seed);
      StringJoiner entries=new StringJoiner(",","[","]"), constellations=new StringJoiner(",","[","]");
      for(int i=0;i<120;i++){int p=b.getNextPiece(),o=b.getNextOctant();entries.add("["+o+","+p+"]");f t=new f();b.getNextConstellation(t);constellations.add(targets(t));}
      cases.add("{\"dense\":"+dense+",\"rings\":"+rings+",\"difficulty\":"+d+",\"seed\":"+seed+",\"entries\":"+entries+",\"targets\":"+constellations+"}");
    }
    Random rng=new Random(1701);StringJoiner matches=new StringJoiner(",","[","]");
    for(int rings:new int[]{3,4})for(int i=0;i<200;i++) {
      RingBoard b=new RingBoard(rings,4);for(int ring=0;ring<rings;ring++)for(int o=0;o<8;o++)b.setPiece(o,ring,rng.nextInt(6)-1);
      // Force wraparound and radial runs into some otherwise random boards.
      if(i%3==0)for(int o:new int[]{7,0,1})b.setPiece(o,0,i%5);
      if(i%5==0)for(int ring=0;ring<rings;ring++)b.setPiece(4,ring,i%5);
      String before=cells(b);Object s=scorer();List<?> found=(List<?>)match.invoke(matcher,b,s);scoreStep.invoke(s);
      matches.add("{\"rings\":"+rings+",\"before\":"+before+",\"runs\":"+runs(found)+",\"after\":"+cells(b)+",\"points\":"+total.invoke(s)+"}");
    }
    // One, two or three run-clear passes before the constellation completes: two or more
    // also add an extra wild target to the next constellation's inner ring.
    StringJoiner wildCases=new StringJoiner(",","[","]");
    for(boolean dense:new boolean[]{false,true})for(int rings:new int[]{3,4})for(boolean enabled:new boolean[]{false,true})for(int i=0;i<60;i++) {
      Object helper=wildClass.getConstructor(boolean.class,int.class).newInstance(enabled,rings);wildClass.getMethod("k").invoke(helper);
      f t=new f();RingBoard generator=new RingBoard(rings,4);generator.setDenseConstellations(dense);generator.initializeSeed(i+1);generator.getNextConstellation(t);
      String before=targets(t);StringJoiner steps=new StringJoiner(",","[","]");
      for(int j=0;j<1+i%3;j++) {
        RingBoard b=new RingBoard(rings,4);for(int o:new int[]{7,0,1})b.setPiece(o,j%rings,2);
        List<?> found=(List<?>)match.invoke(matcher,b,scorer());wildRuns.invoke(helper,found,t);
        steps.add("{\"runs\":"+runs(found)+",\"targets\":"+targets(t)+"}");
      }
      wildCompleted.invoke(helper,t);String completed=targets(t);
      t.b();generator.getNextConstellation(t);wildNext.invoke(helper,t);
      String next=targets(t);wildAction.invoke(helper);
      wildCases.add("{\"dense\":"+dense+",\"rings\":"+rings+",\"enabled\":"+enabled+",\"seed\":"+(i+1)+",\"before\":"+before+",\"steps\":"+steps+",\"completed\":"+completed+",\"next\":"+next+"}");
    }
    // A constellation completed after earlier passes of the same evolution is multiplied bf the
    // chain count, as the controller ends the pass straight after clearing it.
    StringJoiner scores=new StringJoiner(",","[","]");
    for(int rings:new int[]{3,4})for(int i=0;i<100;i++) {
      RingBoard b=new RingBoard(rings,i%10);b.initializeSeed(i+1);f t=new f();b.getNextConstellation(t);
      for(int j=0;j<t.k();j++){if(j%2==0)t.x(j);b.setPiece(t.t(j),t.b(j),j%2==0?(t.k(j)+1)%5:t.k(j));}
      int chain=1+i%3;
      boolean satisfied=(Boolean)targetCheck.invoke(null,b,t);Object s=scorer();for(int c=1;c<chain;c++)scoreStep.invoke(s);
      targetClear.invoke(null,b,t,s);scoreStep.invoke(s);
      scores.add("{\"rings\":"+rings+",\"chain\":"+chain+",\"targets\":"+targets(t)+",\"matches\":"+satisfied+",\"points\":"+total.invoke(s)+",\"after\":"+cells(b)+"}");
    }

    StringJoiner chains=new StringJoiner(",","[","]");
    String[] patterns={"crrrr", "cccrr", "rrcrrc", "rcrcrr", "crarrrc", "rrcarrc", "cercerr", "cccacrr"};
    for(int rings:new int[]{3,4})for(boolean enabled:new boolean[]{false,true})for(int seed=1;seed<=30;seed++)for(String pattern:patterns) {
      Object helper=wildClass.getConstructor(boolean.class,int.class).newInstance(enabled,rings);
      wildClass.getMethod("k").invoke(helper);
      RingBoard generator=new RingBoard(rings,4);generator.setDenseConstellations(true);generator.initializeSeed(seed);
      f t=new f();generator.getNextConstellation(t);String before=targets(t);
      StringJoiner steps=new StringJoiner(",","[","]");
      for(int j=0;j<pattern.length();j++) {
        char op=pattern.charAt(j);String rs="[]";
        if(op=='a')wildAction.invoke(helper);
        else if(op=='c') {wildCompleted.invoke(helper,t);t.b();generator.getNextConstellation(t);wildNext.invoke(helper,t);}
        else if(op=='e')wildRuns.invoke(helper,Collections.emptyList(),t);
        else {
          RingBoard b=new RingBoard(rings,4);for(int o:new int[]{7,0,1})b.setPiece(o,(seed+j)%rings,2);
          List<?> found=(List<?>)match.invoke(matcher,b,scorer());rs=runs(found);wildRuns.invoke(helper,found,t);
        }
        steps.add("{\"op\":\""+op+"\",\"runs\":"+rs+",\"targets\":"+targets(t)+"}");
      }
      chains.add("{\"rings\":"+rings+",\"enabled\":"+enabled+",\"seed\":"+seed+",\"before\":"+before+",\"steps\":"+steps+"}");
    }
    System.out.println("{\"build\":\"20261024072802\",\"generation\":"+cases+",\"matches\":"+matches+",\"wild\":"+wildCases+",\"scores\":"+scores+",\"chains\":"+chains+"}");
  }
}
