import { thingIdFromPermalink } from "./notesTransfer.js";

test("Post ID extracted OK", () => {
    const url = "https://www.reddit.com/r/unitedkingdom/comments/1frajzj/i_left_the_uk_to_live_in_germany_my_commute_now/";
    const expected = "t3_1frajzj";
    const actual = thingIdFromPermalink(url);

    expect(actual).toEqual(expected);
});

test("Comment ID extracted OK", () => {
    const url = "https://www.reddit.com/r/unitedkingdom/comments/1frajzj/i_left_the_uk_to_live_in_germany_my_commute_now/lpbf208/";
    const expected = "t1_lpbf208";
    const actual = thingIdFromPermalink(url);

    expect(actual).toEqual(expected);
});
