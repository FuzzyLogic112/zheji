export async function createDemo(): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = 760;
  canvas.height = 980;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#f4f3ef";
  ctx.fillRect(0, 0, 760, 980);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, 760, 108);
  ctx.fillStyle = "#253246";
  ctx.font = '600 27px "Microsoft YaHei", sans-serif';
  ctx.fillText("和小叶的聊天", 35, 61);
  ctx.fillStyle = "#90959d";
  ctx.font = "17px sans-serif";
  ctx.fillText("虚构示例 · 请勿用于真实联系", 35, 87);
  ctx.fillStyle = "#a2a6ac";
  ctx.font = "17px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("今天 10:26", 380, 156);
  ctx.textAlign = "left";
  const avatar = (x: number, y: number, label: string, color: string) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x, y, 54, 54, 13);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "600 23px sans-serif";
    ctx.fillText(label, x + 15, y + 36);
  };
  const bubble = (
    x: number,
    y: number,
    w: number,
    h: number,
    color: string,
  ) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 15);
    ctx.fill();
  };
  avatar(28, 190, "叶", "#aebbc5");
  bubble(96, 190, 540, 130, "#fff");
  ctx.fillStyle = "#283444";
  ctx.font = '23px "Microsoft YaHei",sans-serif';
  ctx.fillText("可以发给我收货信息吗？", 119, 234);
  ctx.fillText("我把整理好的资料寄给你。", 119, 276);
  avatar(678, 356, "我", "#d79c73");
  bubble(154, 356, 498, 255, "#e2eadb");
  ctx.fillStyle = "#324336";
  ctx.fillText("好，下面是收货信息：", 176, 400);
  ctx.fillText("收件人：小林（虚构）", 176, 448);
  ctx.fillText("电话：138 0000 0000", 176, 496);
  ctx.fillText("地址：示例市星河路 88 号", 176, 544);
  ctx.fillText("（以上均为虚构演示信息）", 176, 583);
  avatar(28, 650, "叶", "#aebbc5");
  bubble(96, 650, 470, 137, "#fff");
  ctx.fillStyle = "#283444";
  ctx.fillText("收到，明天发出。", 119, 695);
  ctx.fillText("订单编号：DEMO-2026-0818", 119, 742);
  ctx.strokeStyle = "#dbdcd6";
  ctx.beginPath();
  ctx.moveTo(28, 864);
  ctx.lineTo(732, 864);
  ctx.stroke();
  ctx.fillStyle = "#929a9d";
  ctx.font = "18px sans-serif";
  ctx.fillText("试试遮住头像、电话、地址和订单编号。", 40, 907);
  ctx.fillText("演示图片由遮迹在当前浏览器生成。", 40, 944);
  return new File(
    [
      await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("无法创建示例"))),
          "image/png",
        ),
      ),
    ],
    "虚构聊天示例.png",
    { type: "image/png" },
  );
}
