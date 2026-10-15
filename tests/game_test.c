#include <assert.h>
#include <stdio.h>
#include <stdint.h>
#include "../src/game.h"

static void steps(int input, int count) {
    game_set_input(input); game_update(count);
}
static void arena(void) {
    int room, pos, direction;
    game_init();
    for (room = 1; room <= 24; ++room) {
        for (pos = 0; pos < 30; ++pos) assert(game_edit_tile(0, room, pos, pos >= 20 ? 1 : 0));
        for (direction = 0; direction < 4; ++direction) assert(game_edit_link(0, room, direction, 0));
        assert(game_edit_guard(0, room, 255));
    }
    game_edit_spawn(0, 1, 23, 1); game_reset(); steps(0, 2);
    assert(game_get_player_grounded());
}
static void test_campaign_and_bounds(void) {
    int level, room, direction, present = 0, events = 0;
    game_init();
    assert(game_get_level_count() == 14);
    for (level = 0; level < 14; ++level) {
        assert(game_select_level(level));
        assert(game_get_room() == game_get_start_room());
        assert(game_get_player_x() == game_get_start_position() % 10 * 32 + 16);
        assert(game_get_player_y() == game_get_start_position() / 10 * 64 + 56);
        for (room = 1; room <= 24; ++room) {
            present += game_get_room_present(room) != 0;
            for (direction = 0; direction < 4; ++direction) {
                int target = game_get_link(room, direction);
                assert(target >= 0 && target <= 24);
            }
        }
        events += game_get_event_count();
    }
    assert(present == 271); assert(events == 146);
    assert(!game_select_level(-1)); assert(!game_select_level(14));
    assert(!game_edit_tile(14, 1, 0, 1)); assert(!game_edit_tile(0, 0, 0, 1));
    assert(!game_edit_tile(0, 25, 0, 1)); assert(!game_edit_tile(0, 1, 30, 1));
    assert(!game_edit_tile(0, 1, 0, 256)); assert(!game_edit_link(0, 1, 4, 0));
    assert(game_get_tile(0, 0) == 0); assert(game_get_event_value(-1, 0) == -1);
}
static void test_floor_wall_and_jump(void) {
    int min_y = 184, i;
    arena(); game_edit_tile(0, 1, 26, 20);
    assert(game_set_player(1, 100, 184, 1)); steps(GAME_INPUT_RIGHT, 60);
    assert(game_get_player_x() <= 187); assert(game_get_player_y() == 184);
    assert(game_get_health() == 3);
    arena(); game_edit_tile(0, 1, 24, 20); game_set_player(1, 144, 90, 1); steps(0, 25);
    assert(game_get_player_y() == 128); assert(game_get_player_grounded());
    arena(); game_edit_tile(0, 1, 24, 0); game_set_player(1, 112, 184, 1); steps(0, 2);
    steps(GAME_INPUT_RIGHT | GAME_INPUT_JUMP, 1);
    assert(game_get_player_vy() < 0); assert(!game_get_player_grounded());
    for (i = 0; i < 44; ++i) {
        steps(GAME_INPUT_RIGHT, 1);
        if (game_get_player_y() < min_y) min_y = game_get_player_y();
    }
    assert(min_y < 145); assert(game_get_player_x() > 160);
    assert(game_get_player_grounded()); assert(game_get_health() == 3);
}
static void test_room_links(void) {
    arena(); game_edit_link(0, 1, GAME_LINK_RIGHT, 2); game_edit_link(0, 2, GAME_LINK_LEFT, 1);
    game_set_player(1, 310, 184, 1); steps(GAME_INPUT_RIGHT, 20);
    assert(game_get_room() == 2); assert(game_get_player_x() < 60);
    steps(GAME_INPUT_LEFT, 45); assert(game_get_room() == 1);
    arena(); game_edit_link(0, 1, GAME_LINK_DOWN, 2);
    game_edit_tile(0, 1, 23, 0); game_set_player(1, 112, 184, 1); steps(0, 24);
    assert(game_get_room() == 2); assert(game_get_player_y() < 100);
    arena(); game_edit_tile(0, 1, 23, 0); game_set_player(1, 112, 184, 1); steps(0, 30);
    assert(game_get_flags() & GAME_FLAG_DEAD);
}
static void test_hazards_and_fall_damage(void) {
    arena(); game_edit_tile(0, 1, 23, 2); game_set_player(1, 112, 184, 1); steps(0, 2);
    assert(game_get_flags() & GAME_FLAG_DEAD);
    arena(); game_edit_tile(0, 1, 23, 2); game_set_player(1, 112, 184, 1); steps(GAME_INPUT_ACTION, 2);
    assert(game_get_health() == 3);
    arena(); game_set_player(1, 112, 20, 1); steps(0, 60);
    assert(game_get_health() == 2); assert(game_get_player_grounded());
    arena(); game_edit_tile(0, 1, 23, 18); game_set_player(1, 112, 184, 1); steps(0, 100);
    assert(game_get_flags() & GAME_FLAG_DEAD);
}
static void test_gate_events_and_exit(void) {
    arena(); game_edit_tile(0, 1, 23, 15); game_edit_tile(0, 1, 26, 4);
    assert(game_edit_event(0, 0, 1, 23, 0, 1, 26));
    game_set_player(1, 112, 184, 1); steps(0, 40);
    assert(game_get_gate(1, 26) == 64);
    steps(GAME_INPUT_RIGHT, 45); assert(game_get_player_x() > 198);
    assert(game_edit_event(0, 0, 1, 23, 1, 1, 26));
    game_trigger(1, 23); steps(0, 270); assert(game_get_gate(1, 26) == 0);
    arena(); game_edit_tile(0, 1, 23, 15); game_edit_tile(0, 1, 26, 16);
    game_edit_event(0, 0, 1, 23, 0, 1, 26);
    game_trigger(1, 23); steps(0, 35); game_set_player(1, 208, 184, 1); steps(0, 2);
    steps(GAME_INPUT_UP, 1); assert(game_get_flags() & GAME_FLAG_LEVEL_COMPLETE);
    steps(0, 90); assert(game_get_level() == 1);
}
static void test_pickups_and_loose_floor(void) {
    arena(); game_edit_tile(0, 1, 23, 22); game_set_player(1, 112, 184, 1); steps(0, 2);
    steps(GAME_INPUT_DOWN, 1); assert(game_get_has_sword()); assert((game_get_tile(1, 23) & 31) == 1);
    arena(); game_edit_tile(0, 1, 23, 74); game_set_player(1, 112, 184, 1); steps(0, 2);
    steps(GAME_INPUT_DOWN, 1); assert(game_get_max_health() == 4); assert(game_get_health() == 4);
    arena(); game_edit_tile(0, 1, 23, 11); game_set_player(1, 112, 184, 1); steps(0, 2);
    assert(game_get_tile_state(1, 23) > 0); steps(0, 30); assert((game_get_tile(1, 23) & 31) == 0);
    steps(0, 35); assert(game_get_flags() & GAME_FLAG_DEAD);
    game_reset(); assert((game_get_tile(1, 23) & 31) == 11); assert(game_get_health() == 3);
}
static void test_combat_and_timer(void) {
    int i, initial;
    arena(); game_edit_guard(0, 1, 25); game_reset(); game_set_has_sword(1);
    game_set_player(1, 150, 184, 1); steps(0, 2);
    for (i = 0; i < 8 && game_get_guard_active(1); ++i) {
        steps(GAME_INPUT_ACTION, 1); steps(GAME_INPUT_UP, 35);
    }
    assert(game_get_guard_health(1) < 3);
    assert(!game_get_guard_active(1)); assert(game_get_health() > 0);
    arena(); initial = game_get_time_left(); steps(0, 60); assert(game_get_time_left() == initial - 1);
    game_set_paused(1); steps(GAME_INPUT_RIGHT, 120); assert(game_get_time_left() == initial - 1);
    assert(game_get_flags() & GAME_FLAG_PAUSED);
}
static void test_guard_animation(void) {
    int i, before, attempts;
    arena(); game_edit_guard(0, 1, 25); game_reset(); game_set_has_sword(1);
    game_set_player(1, 70, 184, 1); steps(0, 1);
    assert(game_get_guard_state(1) == GAME_GUARD_MOVE);
    assert(game_get_guard_native_frame(1) == 164);
    assert(game_get_guard_x(1) == 164);
    /* Original advance: a12px step, followed by164/165/158/170/171.
     * These poses must be visible even while the anchor stays still. */
    steps(0, 4); assert(game_get_guard_native_frame(1) == 165);
    assert(game_get_guard_x(1) == 164);
    steps(0, 4); assert(game_get_guard_native_frame(1) == 158);
    steps(0, 4); assert(game_get_guard_native_frame(1) == 170);
    steps(0, 4); assert(game_get_guard_native_frame(1) == 171);
    before = game_get_guard_animation(1); game_set_paused(1); steps(0, 40);
    assert(game_get_guard_animation(1) == before); game_set_paused(0);
    steps(0, 4); assert(game_get_guard_native_frame(1) == 164);
    assert(game_get_guard_x(1) == 152);
    /* A wall prevents both the step and repeated walk animation. */
    arena(); game_edit_guard(0, 1, 25); game_edit_tile(0, 1, 24, 20); game_reset();
    game_set_player(1, 70, 184, 1); steps(0, 60);
    assert(game_get_guard_x(1) == 176); assert(game_get_guard_state(1) == GAME_GUARD_IDLE);
    assert(game_get_guard_native_frame(1) == 171);
    /* Sword extension causes one hit; a successful block gets a complete
     * parry sequence rather than immediately being mistaken for hurt. */
    arena(); game_edit_guard(0, 1, 25); game_reset(); game_set_has_sword(1);
    game_set_player(1, 150, 184, 1);
    for (i = 0; i < 80 && game_get_guard_state(1) != GAME_GUARD_ATTACK; ++i) steps(0, 1);
    assert(game_get_guard_native_frame(1) == 151);
    steps(GAME_INPUT_UP, 4); assert(game_get_guard_native_frame(1) == 152);
    steps(GAME_INPUT_UP, 4); assert(game_get_guard_state(1) == GAME_GUARD_PARRY);
    assert(game_get_guard_native_frame(1) == 167); assert(game_get_health() == 3);
    steps(GAME_INPUT_UP, 4); assert(game_get_guard_state(1) == GAME_GUARD_PARRY);
    assert(game_get_guard_native_frame(1) == 155);
    /* Death animation remains visible after active collision is disabled. */
    arena(); game_edit_guard(0, 1, 25); game_reset(); game_set_has_sword(1);
    for (attempts = 0; attempts < 6 && game_get_guard_active(1); ++attempts) {
        game_set_health(3); game_set_player(1, game_get_guard_x(1) - 26, 184, 1);
        steps(0, 1); steps(GAME_INPUT_ACTION, 1); steps(GAME_INPUT_UP, 5);
        if (game_get_guard_active(1)) {
            assert(game_get_guard_state(1) == GAME_GUARD_HURT);
            assert(game_get_guard_native_frame(1) == 172);
            steps(GAME_INPUT_UP, 4); assert(game_get_guard_native_frame(1) == 173);
            steps(GAME_INPUT_UP, 4); assert(game_get_guard_native_frame(1) == 174);
            steps(GAME_INPUT_UP, 4); assert(game_get_guard_native_frame(1) == 156);
            steps(GAME_INPUT_UP, 22);
        }
    }
    assert(!game_get_guard_active(1)); assert(game_get_guard_visible(1));
    assert(game_get_guard_native_frame(1) == 179);
    steps(0, 4); assert(game_get_guard_native_frame(1) == 180);
    steps(0, 4); assert(game_get_guard_native_frame(1) == 181);
    steps(0, 4); assert(game_get_guard_native_frame(1) == 182);
    steps(0, 100); assert(game_get_guard_native_frame(1) == 183);
    assert(game_get_guard_visible(1));
    game_edit_guard(0, 1, 255); game_reset(); assert(!game_get_guard_visible(1));
}
static void test_ledge_grab_and_climb(void) {
    int i, side;
    for (side = -1; side <= 1; side += 2) {
        arena(); game_edit_tile(0, 1, 15, 1);
        game_set_player(1, side > 0 ? 150 : 202, 184, side); steps(0, 2);
        steps(GAME_INPUT_ACTION | GAME_INPUT_JUMP, 1);
        for (i = 0; i < 70 && game_get_player_state() != GAME_HANG; ++i) steps(GAME_INPUT_ACTION, 1);
        assert(game_get_player_state() == GAME_HANG);
        /* ROM F882 catch anchors for ledge column5,row1. Frame79 was the
         * incorrect reach pose; native91 grips at nativeY191-58=133. */
        assert(game_get_player_native_frame() == 91);
        assert(game_get_player_render_x() == (side > 0 ? 185 : 216));
        assert(game_get_player_render_y() == 191);
        steps(GAME_INPUT_ACTION, 4); assert(game_get_player_native_frame() == 90);
        assert(game_get_player_render_y() == 191);
        steps(GAME_INPUT_ACTION | GAME_INPUT_UP, 1);
        assert(game_get_player_state() == GAME_CLIMB);
        assert(game_get_player_native_frame() == 135);
        assert(game_get_player_render_x() == (side > 0 ? 184 : 218));
        assert(game_get_player_render_y() == 192);
        steps(0, 23); assert(game_get_player_native_frame() == 140);
        assert(game_get_player_render_y() == 192);
        steps(0, 1); assert(game_get_player_native_frame() == 141);
        assert(game_get_player_render_x() == (side > 0 ? 194 : 208));
        assert(game_get_player_render_y() == 129);
        steps(0, 28); assert(game_get_player_native_frame() == 149);
        steps(0, 4); assert(game_get_player_state() == GAME_STAND);
        assert(game_get_player_y() == 121);
        assert(game_get_player_x() == (side > 0 ? 176 : 186));
        assert(game_get_player_grounded());
        /* Lower from each exposed edge, then release without an instant
         * re-grab or accidental second climb. */
        game_set_player(1, side > 0 ? 166 : 186, 120, -side); steps(0, 2);
        steps(GAME_INPUT_DOWN, 1); assert(game_get_player_state() == GAME_LOWER);
        steps(GAME_INPUT_ACTION, 44); assert(game_get_player_state() == GAME_HANG);
        assert(game_get_player_native_frame() == 91);
        assert(game_get_player_render_x() == (side > 0 ? 185 : 217));
        assert(game_get_player_render_y() == 191);
        steps(side > 0 ? GAME_INPUT_ACTION | GAME_INPUT_DOWN : 0, 1); assert(game_get_player_state() == GAME_RELEASE);
        assert(game_get_player_native_frame() == 83);
        steps(GAME_INPUT_ACTION, 12); assert(game_get_player_state() != GAME_HANG);
        assert(game_get_player_grounded());
    }
    /* An interior Down press remains a crouch; there is no exposed edge. */
    arena(); steps(GAME_INPUT_DOWN, 1); assert(game_get_player_state() == GAME_CROUCH);
    /* A closed gate at the destination blocks climbing through it. */
    arena(); game_edit_tile(0, 1, 15, 4); game_set_player(1, 150, 184, 1); steps(0, 2);
    steps(GAME_INPUT_ACTION | GAME_INPUT_JUMP, 1);
    for (i = 0; i < 70 && game_get_player_state() != GAME_HANG; ++i) steps(GAME_INPUT_ACTION, 1);
    assert(game_get_player_state() == GAME_HANG);
    steps(GAME_INPUT_ACTION | GAME_INPUT_UP, 1); assert(game_get_player_state() == GAME_HANG);
    /* Grip animation is finite in the source: it settles onto a floor below
     * instead of freezing frame92 forever while Action remains held. */
    arena(); game_edit_tile(0, 1, 15, 1); game_set_player(1, 150, 184, 1); steps(0, 2);
    steps(GAME_INPUT_ACTION | GAME_INPUT_JUMP, 1);
    for (i = 0; i < 70 && game_get_player_state() != GAME_HANG; ++i) steps(GAME_INPUT_ACTION, 1);
    steps(GAME_INPUT_ACTION, 172); assert(game_get_player_state() == GAME_RELEASE);
    assert(game_get_player_native_frame() == 83);
    steps(GAME_INPUT_ACTION, 12); assert(game_get_player_grounded());
    /* An upper-room ledge uses that room's final local coordinates, with no
     * interpolation across a whole screen. */
    arena(); game_edit_tile(0, 1, 4, 1); game_edit_link(0, 1, GAME_LINK_UP, 2);
    for (i = 20; i < 30; ++i) game_edit_tile(0, 2, i, i == 25 ? 1 : 0);
    game_set_player(1, 150, 56, 1); steps(0, 2);
    steps(GAME_INPUT_ACTION | GAME_INPUT_JUMP, 1);
    for (i = 0; i < 70 && game_get_player_state() != GAME_HANG; ++i) steps(GAME_INPUT_ACTION, 1);
    assert(game_get_player_state() == GAME_HANG); assert(game_get_room() == 1);
    steps(GAME_INPUT_ACTION | GAME_INPUT_UP, 1); steps(0, 56);
    assert(game_get_room() == 2); assert(game_get_player_x() == 176);
    assert(game_get_player_y() == 185); assert(game_get_player_grounded());
}
static void test_campaign_stress(void) {
    uint32_t seed = 0x71337337u;
    int level, frame;
    game_init();
    for (level = 0; level < game_get_level_count(); ++level) {
        game_select_level(level);
        for (frame = 0; frame < 6000; ++frame) {
            if (frame % 13 == 0) {
                seed ^= seed << 13; seed ^= seed >> 17; seed ^= seed << 5;
                game_set_input((int)(seed & 63));
            }
            game_step();
            assert(game_get_room() >= 1 && game_get_room() <= 24);
            assert(game_get_room_present(game_get_room()));
            assert(game_get_health() >= 0 && game_get_health() <= game_get_max_health());
            if (game_get_flags() & GAME_FLAG_DEAD) {
                game_set_input(0); game_reset();
            }
        }
    }
}
int main(void) {
    test_campaign_and_bounds(); test_floor_wall_and_jump(); test_room_links();
    test_hazards_and_fall_damage(); test_gate_events_and_exit();
    test_pickups_and_loose_floor(); test_combat_and_timer(); test_guard_animation(); test_ledge_grab_and_climb();
    test_campaign_stress();
    puts("C gameplay tests passed: campaign bounds, collision, jump, room links, hazards, events, exits, pickups, loose floors, combat, timer, ledges.");
    return 0;
}
